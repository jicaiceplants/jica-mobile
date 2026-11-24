const { withProjectBuildGradle } = require('@expo/config-plugins');

const withAndroidForceCore = (config) => {
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
