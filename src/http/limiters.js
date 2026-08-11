const { config } = require('../config/env')
const { createRateLimiters } = require('./rate-limit')

module.exports = createRateLimiters({
  ...config.rateLimits,
  trustCloudflare: config.isRender
})
