export const ANDROID_NDK_VERSION = "28.2.13676358";
export const ANDROID_BUILD_TOOLS_VERSION = "36.0.0";
export const ANDROID_SDK_PACKAGES = [
  "platform-tools",
  "platforms;android-36",
  "platforms;android-37.0",
  `build-tools;${ANDROID_BUILD_TOOLS_VERSION}`,
  `ndk;${ANDROID_NDK_VERSION}`,
];
