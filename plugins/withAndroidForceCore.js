const { withProjectBuildGradle, withGradleProperties } = require('@expo/config-plugins');

const setGradleProperty = (modResults, key, value) => {
  const prop = modResults.find(
    (item) => item.type === 'property' && item.key === key
  );
  if (prop) {
    prop.value = value;
  } else {
    modResults.push({
      type: 'property',
      key,
      value,
    });
  }
};

const withAndroidForceCore = (config) => {
  // Set gradle.properties for architecture, minification, and stability
  config = withGradleProperties(config, (modConfig) => {
    // Strictly disable New Architecture for react-native-maps & SQLite stability
    setGradleProperty(modConfig.modResults, 'newArchEnabled', 'false');

    // Disable release minification & resource shrinking so R8 does not strip WorkDatabase or Room reflection classes
    setGradleProperty(modConfig.modResults, 'android.enableMinifyInReleaseBuilds', 'false');
    setGradleProperty(modConfig.modResults, 'android.enableShrinkResourcesInReleaseBuilds', 'false');

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
