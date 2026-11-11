"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  OledDialogRequest,
  resolveActiveOledDialog,
  subscribeOledDialog,
} from "@/lib/oledDialog";
import { registerModalDismiss } from "@/lib/navigation/backNavigation";

export default function OledDialogHost() {
  const [dialog, setDialog] = useState<OledDialogRequest | null>(null);

  useEffect(() => {
    return subscribeOledDialog(setDialog);
  }, []);

  useEffect(() => {
    if (!dialog) return;
    return registerModalDismiss(() => {
      resolveActiveOledDialog(false);
      return true;
    });
  }, [dialog]);

  return (
    <AnimatePresence>
      {dialog && (
        <motion.div
          key={dialog.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => {
            if (dialog.kind === "alert") {
              resolveActiveOledDialog(true);
            } else {
              resolveActiveOledDialog(false);
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm max-h-[85dvh] overflow-y-auto bg-[#06080C] border border-white/15 rounded-3xl p-5 flex flex-col gap-4 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <img
                src="/images/brand_logo_header.png"
                srcSet="/images/brand_logo_header.png 1x, /images/brand_logo_full.png 2x"
                alt="ARCHERY 101010"
                className="h-3.5 w-auto object-contain"
              />
              <span className="text-[11.5px] font-black uppercase tracking-widest text-white px-2 py-0.5 rounded-full bg-[#12151C] border border-white/10">
                {dialog.kind === "confirm" ? "Confirmación" : "Aviso"}
              </span>
            </div>

            <div className="text-white text-[15.5px] font-semibold leading-relaxed whitespace-pre-line break-words tabular-nums">
              {dialog.message}
            </div>

            {dialog.kind === "confirm" ? (
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => resolveActiveOledDialog(false)}
                  className="w-full py-2.5 px-3 rounded-2xl bg-[#12151C] border border-white/15 text-white font-black text-xs uppercase tracking-wider cursor-pointer hover:bg-white/10 transition"
                >
                  {dialog.cancelLabel || "Cancelar"}
                </button>
                <button
                  type="button"
                  onClick={() => resolveActiveOledDialog(true)}
                  className="w-full py-2.5 px-3 rounded-2xl bg-cyan-neon text-black font-black text-xs uppercase tracking-wider cursor-pointer hover:bg-cyan-brand transition"
                >
                  {dialog.confirmLabel || "Confirmar"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => resolveActiveOledDialog(true)}
                className="w-full py-2.5 px-4 rounded-2xl bg-cyan-neon text-black font-black text-xs uppercase tracking-wider cursor-pointer hover:bg-cyan-brand transition mt-1"
              >
                {dialog.confirmLabel || "Entendido"}
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
