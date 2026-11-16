# ProGuard / R8 rules for ARCHERY 101010 Android App
-keepattributes JavascriptInterface,*Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# Preserve all ARCHERY 101010 classes and @JavascriptInterface WebView bridges
-keep class com.archery101010.app.** { *; }
-keepclassmembers class com.archery101010.app.** {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve Capacitor core & reflective plugin methods
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep @com.getcapacitor.NativePlugin class * { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep public class * extends org.apache.cordova.CordovaPlugin { *; }
-keep class org.apache.cordova.** { *; }

# Preserve Google Play Services (Auth + Wearable Data Layer)
-keep class com.google.android.gms.common.annotation.KeepName
-keepnames @com.google.android.gms.common.annotation.KeepName class *
-keepclassmembernames class * {
    @com.google.android.gms.common.annotation.KeepName *;
}
-keep public class * extends com.google.android.gms.wearable.WearableListenerService { *; }
-dontwarn com.google.errorprone.annotations.**

# Preserve Official Spotify App Remote SDK & Gson models
-keep class com.spotify.** { *; }
-dontwarn com.spotify.**
-keep class com.google.gson.** { *; }
-keep class * implements com.google.gson.TypeAdapter
-keep class * implements com.google.gson.TypeAdapterFactory
-keep class * implements com.google.gson.JsonSerializer
-keep class * implements com.google.gson.JsonDeserializer
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
