const webpack = require('webpack');
const path = require('path');

// Load environment variables from the main project root .env so REACT_APP_* are available in client
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

module.exports = function override(config) {
  config.resolve = config.resolve || {};
  config.resolve.fallback = {
    ...(config.resolve.fallback || {}),
    crypto: require.resolve('crypto-browserify'),
    buffer: require.resolve('buffer/'),
    vm: require.resolve('vm-browserify'),
    process: require.resolve('process/browser.js'),
    stream: require.resolve('stream-browserify')
  };

  config.plugins = config.plugins || [];
  config.plugins.push(
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser.js'
    })
  );

  return config;
};


