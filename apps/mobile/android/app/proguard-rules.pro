# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# --- ML Kit barcode scanning (react-native-vision-camera CodeScanner) ---
#
# ML Kit publishes its component registrars only as manifest meta-data reached
# through MlKitComponentDiscoveryService, then instantiates them with
# Class.forName(value).getDeclaredConstructor().newInstance(). R8 cannot see
# that call site, and ML Kit's bundled proguard.txt keeps <init> only on
# @UsedBy-annotated classes — so every registrar lost its no-arg constructor.
# Discovery then logged NoSuchMethodException, the barcode module never
# registered, and the first scan died inside CodeScannerPipeline.<init> with a
# null dereference in its ML Kit internals. Debug builds never hit this
# because they are not minified.
-keep class * implements com.google.firebase.components.ComponentRegistrar { *; }

# The scanner also reflects over these (bundled proto fields and the native
# odml bridge); the bundled rules cover them only in part.
-keep class com.google.android.gms.internal.mlkit_** { *; }
-keep class com.google.android.odml.** { *; }
