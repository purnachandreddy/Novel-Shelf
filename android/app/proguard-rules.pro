# Novel Shelf ProGuard rules
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve AndroidBridge inner class and all its methods
-keep class com.novelshelf.app.MainActivity$AndroidBridge { *; }

# Preserve MainActivity, inner classes, callbacks and packages
-keep class com.novelshelf.app.MainActivity { *; }
-keep class com.novelshelf.app.MainActivity$* { *; }
-keep class com.novelshelf.app.** { *; }
-keepclassmembers class * extends androidx.core.view.WindowInsetsAnimationCompat$Callback { *; }
-keepclassmembers class * extends androidx.core.view.OnApplyWindowInsetsListener { *; }
-keepclassmembers class * extends androidx.activity.OnBackPressedCallback { *; }
