const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY || "AIzaSyDLXnIoJZ52QoTQH3m330JH1Su_ly0qF1w";

module.exports = ({ config }) => ({
  ...config,
  name: "IceTrack",
  slug: "icetrack-mobile",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  updates: {
    enabled: false,
    checkAutomatically: "NEVER"
  },
  ios: {
    supportsTablet: true
  },
  android: {
    versionCode: 2,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png"
    },
    predictiveBackGestureEnabled: false,
    permissions: [
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "INTERNET",
      "ACCESS_NETWORK_STATE"
    ],
    config: {
      googleMaps: {
        apiKey: GOOGLE_MAPS_KEY
      }
    },
    package: "com.jicaiceplants.icetrackmobile"
  },
  web: {
    favicon: "./assets/favicon.png"
  },
  plugins: [
    "expo-sqlite",
    "expo-status-bar",
    [
      "expo-splash-screen",
      {
        "image": "./assets/splash-icon.png",
        "imageWidth": 200,
        "resizeMode": "contain",
        "backgroundColor": "#F1F5F9"
      }
    ],
    [
      "expo-build-properties",
      {
        "android": {
          "compileSdkVersion": 37,
          "targetSdkVersion": 36,
          "newArchEnabled": false,
          "enableMinifyInReleaseBuilds": false,
          "extraProguardRules": [
            "# Keep WorkManager Database and Room reflection classes from R8 stripping",
            "-keep class androidx.work.** { *; }",
            "-keep class androidx.work.impl.** { *; }",
            "-keep class * extends androidx.room.RoomDatabase {",
            "    <init>();",
            "    *;",
            "}",
            "-keepclassmembers class * extends androidx.room.RoomDatabase {",
            "    <init>();",
            "}",
            "-dontwarn androidx.work.**"
          ].join("\n")
        }
      }
    ],
    "./plugins/withAndroidForceCore.js"
  ],
  extra: {
    eas: {
      projectId: "169a5b4c-fd4e-48d2-9293-9aa3e16ee2f7"
    }
  }
});
