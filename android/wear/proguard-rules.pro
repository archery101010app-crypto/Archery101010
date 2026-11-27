# ProGuard / R8 rules for ARCHERY 101010 Wear OS
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
-keep class com.archery101010.app.** { *; }
-keep public class * extends com.google.android.gms.wearable.WearableListenerService { *; }
-keep class com.google.android.gms.common.annotation.KeepName
-keepnames @com.google.android.gms.common.annotation.KeepName class *
-keepclassmembernames class * {
    @com.google.android.gms.common.annotation.KeepName *;
}
-keep class androidx.health.services.client.** { *; }
-keepclassmembers class * extends androidx.health.services.client.proto.GeneratedMessageLite {
    <fields>;
}
