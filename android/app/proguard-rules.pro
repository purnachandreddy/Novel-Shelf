# Novel Shelf ProGuard rules
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve AndroidBridge inner class and all its methods
-keep class com.novelshelf.app.MainActivity$AndroidBridge { *; }

# Preserve MainActivity and callback classes
-keep class com.novelshelf.app.MainActivity { *; }
-keepclassmembers class androidx.core.view.WindowInsetsAnimationCompat$Callback { *; }
