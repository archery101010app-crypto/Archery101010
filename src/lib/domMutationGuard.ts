/**
 * Protects React 19 Fiber reconciliation from third-party DOM mutators
 * (Chrome Auto-Translate, Samsung/Android WebView translators, legacy Google
 * Translate `<font>` wrappers, and browser extensions) that wrap or reparent
 * text nodes behind React's back and otherwise trigger:
 *   - NotFoundError: Failed to execute 'removeChild' on 'Node'
 *   - NotFoundError: Failed to execute 'insertBefore' on 'Node'
 */

export interface PatchableNodePrototype {
  __archeryDomPatched?: boolean;
  removeChild: <T extends Node>(child: T) => T;
  insertBefore: <T extends Node>(newNode: T, referenceNode: Node | null) => T;
}

export function applyDomMutationPatch(proto: PatchableNodePrototype): void {
  if (!proto || proto.__archeryDomPatched) return;

  const origRemoveChild = proto.removeChild;
  const origInsertBefore = proto.insertBefore;

  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child && child.parentNode !== this) {
      const actualParent = child.parentNode;
      if (actualParent) {
        const removed = origRemoveChild.call(actualParent, child) as T;
        // Clean up empty <font> translation wrappers left inside this container
        let cursor: Node | null = actualParent;
        while (
          cursor &&
          cursor !== this &&
          cursor.nodeName === "FONT" &&
          cursor.childNodes.length === 0 &&
          cursor.parentNode
        ) {
          const nextParent: Node | null = cursor.parentNode;
          origRemoveChild.call(nextParent, cursor);
          cursor = nextParent;
        }
        return removed;
      }
      return child;
    }
    return origRemoveChild.call(this, child) as T;
  };

  proto.insertBefore = function <T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      // If a translator wrapped referenceNode in <font> inside `this`, insert before that wrapper
      let ancestor: Node | null = referenceNode.parentNode;
      while (ancestor && ancestor.parentNode !== this) {
        ancestor = ancestor.parentNode;
      }
      if (ancestor && ancestor.parentNode === this) {
        return origInsertBefore.call(this, newNode, ancestor) as T;
      }
      return origInsertBefore.call(this, newNode, null) as T;
    }
    return origInsertBefore.call(this, newNode, referenceNode) as T;
  };

  try {
    Object.defineProperty(proto, "__archeryDomPatched", {
      value: true,
      configurable: true,
      enumerable: false,
      writable: false
    });
  } catch {
    proto.__archeryDomPatched = true;
  }
}

export function installDomMutationGuard(): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof Node === "function" && Node.prototype) {
      applyDomMutationPatch(Node.prototype as unknown as PatchableNodePrototype);
    }
    if (typeof document !== "undefined") {
      document.documentElement?.setAttribute("translate", "no");
      document.documentElement?.classList.add("notranslate");
      document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      if (window.location?.hostname) {
        document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${window.location.hostname};`;
      }
    }
  } catch {
    // Never throw during early bootstrap
  }
}

export const DOM_MUTATION_GUARD_INLINE_SCRIPT = `(function(){try{if(typeof Node==="function"&&Node.prototype&&!Node.prototype.__archeryDomPatched){var r=Node.prototype.removeChild,i=Node.prototype.insertBefore;Node.prototype.removeChild=function(c){if(c&&c.parentNode!==this){var p=c.parentNode;if(p){var out=r.call(p,c),cur=p;while(cur&&cur!==this&&cur.nodeName==="FONT"&&cur.childNodes.length===0&&cur.parentNode){var np=cur.parentNode;r.call(np,cur);cur=np;}return out;}return c;}return r.call(this,c);};Node.prototype.insertBefore=function(n,ref){if(ref&&ref.parentNode!==this){var a=ref.parentNode;while(a&&a.parentNode!==this){a=a.parentNode;}if(a&&a.parentNode===this){return i.call(this,n,a);}return i.call(this,n,null);}return i.call(this,n,ref);};Object.defineProperty(Node.prototype,"__archeryDomPatched",{value:true,configurable:true});}if(typeof document!=="undefined"){document.cookie="googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";if(typeof location!=="undefined"&&location.hostname){document.cookie="googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain="+location.hostname+";";}}}catch(e){}})();`;
