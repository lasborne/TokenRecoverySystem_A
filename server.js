/**
 * Main server file for the Airdrop Recovery System
 * Refactored to use modular architecture with proper separation of concerns
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');
require('dotenv').config();

// Import modular components
const apiRoutes = require('./server/routes/api.js');
const RecoveryService = require('./server/services/recoveryService.js');
const { getNetworkConfig, getAllNetworks } = require('./server/config/networks.js');

// Initialize services
const recoveryService = new RecoveryService();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy for rate limiting (needed when behind a proxy like React dev server)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting to prevent abuse
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Use a custom key generator that doesn't rely on X-Forwarded-For
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress || 'unknown';
  }
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));



// API routes
app.use('/api', apiRoutes);

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'client/build')));

// Catch-all handler: send back React's index.html file for any non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

// Global error handling middleware
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);
  
  // Don't leak error details in production
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : error.message;
  
  res.status(500).json({
    error: errorMessage,
    timestamp: new Date().toISOString()
  });
});

// Scheduled task to monitor recoveries
const scheduleRecoveryMonitoring = () => {
  // Run every 30 seconds
  cron.schedule('*/30 * * * * *', async () => {
    try {
      console.log('Running scheduled recovery monitoring...');
      
      const activeRecoveries = recoveryService.getActiveRecoveries();
      
      if (activeRecoveries.length === 0) {
        console.log('No active recoveries found to monitor');
        return;
      }
      
      // Process each recovery with improved error handling
      for (const recovery of activeRecoveries) {
        try {
          if (!recovery.hackedWallet || !recovery.network) {
            console.warn(`Skipping invalid recovery: Missing required fields`, 
              { id: recovery.id, hasWallet: !!recovery.hackedWallet, hasNetwork: !!recovery.network });
            continue;
          }
          
          console.log(`Monitoring recovery for ${recovery.hackedWallet} on ${recovery.network}...`);
          
          const result = await recoveryService.monitorAndClaimAirdrops(
            recovery.hackedWallet, 
            recovery.network
          );
          
          if (!result.success && result.error) {
            console.warn(`Monitoring result for ${recovery.hackedWallet}: ${result.error}`);
          }
        } catch (error) {
          // Don't let one failed recovery stop the others
          console.error(`Error monitoring recovery ${recovery.id || recovery.hackedWallet}:`, error.message);
        }
      }
      
      console.log(`Monitored ${activeRecoveries.length} active recoveries`);
    } catch (error) {
      console.error('Scheduled monitoring error:', error.message);
    }
  });
  
  console.log('Recovery monitoring scheduled to run every 30 seconds');
};

// Start the server
const startServer = async () => {
  try {
    // Start the Express server
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 API available at: http://localhost:${PORT}/api`);
      console.log(`🌐 Client available at: http://localhost:${PORT}`);
    });

    // Start scheduled monitoring
    scheduleRecoveryMonitoring();

    // Schedule cleanup of old auto recovery sessions (every hour)
    cron.schedule('0 * * * *', () => {
      try {
        const AutoRecoveryService = require('./server/services/autoRecoveryService.js');
        const autoRecoveryService = new AutoRecoveryService();
        autoRecoveryService.cleanupOldSessions();
        console.log('Auto recovery sessions cleanup completed');
      } catch (error) {
        console.error('Auto recovery cleanup error:', error);
      }
    });

    // Log startup information
    console.log('✅ Airdrop Recovery System started successfully');
    console.log('📋 Supported networks:', Object.keys(getAllNetworks()).join(', '));
    
    return server;
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
const gracefulShutdown = (server, signal) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  // Stop the server
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Start the server and handle shutdown
startServer().then(server => {
  // Listen for shutdown signals
  process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
}); 