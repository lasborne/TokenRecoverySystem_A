# API Configuration

This React frontend now uses environment variables to configure the API endpoint, allowing easy switching between development and production environments.

## Environment Variables

### Development (.env)
```
REACT_APP_API_URL=http://localhost:5000
```

### Production (.env.production)
```
REACT_APP_API_URL=https://tokenrecoverysystem-a.onrender.com
```

## How It Works

1. The frontend reads the `REACT_APP_API_URL` environment variable
2. If not set, it defaults to `http://localhost:5000` for development
3. All API calls now use this base URL instead of hardcoded localhost URLs
4. The proxy configuration in package.json has been removed

## Deployment

### For Development
- The `.env` file is used automatically
- API calls go to `http://localhost:5000`

### For Production
- The `.env.production` file is used during build
- API calls go to `https://tokenrecoverysystem-a.onrender.com`
- Run `npm run build` to create the production build

## Files Modified

- `client/src/App.js` - Updated all axios calls to use `API_BASE` variable
- `client/src/solana/recovery.js` - Updated fetch calls to use environment variable
- `client/package.json` - Removed proxy configuration
- `client/.env` - Created with development API URL
- `client/.env.production` - Created with production API URL

## Testing

To test the configuration:

1. **Development**: Run `npm start` - should connect to localhost:5000
2. **Production**: Run `npm run build` then serve the build folder - should connect to the production API

The frontend will automatically use the correct API URL based on the environment.
