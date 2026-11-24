const { withProjectBuildGradle, withGradleProperties } = require('@expo/config-plugins');

const withAndroidForceCore = (config) => {
  // Ensure newArchEnabled is strictly false for react-native-maps compatibility
  config = withGradleProperties(config, (modConfig) => {
    const newArchProp = modConfig.modResults.find(
      (item) => item.type === 'property' && item.key === 'newArchEnabled'
    );
    if (newArchProp) {
      newArchProp.value = 'false';
    } else {
      modConfig.modResults.push({
        type: 'property',
        key: 'newArchEnabled',
        value: 'false',
      });
    }
    return modConfig;
  });

  // Force androidx.core to 1.15.0 to prevent 1.17.0 compileSdk conflicts
  return withProjectBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language === 'groovy') {
      const forceResolution = `
allprojects {
  configurations.all {
    resolutionStrategy {
      force 'androidx.core:core:1.15.0'
      force 'androidx.core:core-ktx:1.15.0'
    }
  }
}
`;
      if (!modConfig.modResults.contents.includes("force 'androidx.core:core:1.15.0'")) {
        modConfig.modResults.contents += forceResolution;
      }
    }
    return modConfig;
  });
};

module.exports = withAndroidForceCore;
