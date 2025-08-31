#!/bin/bash

# Airdrop Recovery System - Quick Start Script
# This script automates the initial setup process

set -e  # Exit on any error

echo "🚀 Airdrop Recovery System - Quick Start"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Node.js is installed
check_nodejs() {
    print_status "Checking Node.js installation..."
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js v16 or higher."
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 16 ]; then
        print_error "Node.js version 16 or higher is required. Current version: $(node -v)"
        exit 1
    fi
    
    print_success "Node.js $(node -v) is installed"
}

# Check if npm is installed
check_npm() {
    print_status "Checking npm installation..."
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed."
        exit 1
    fi
    
    print_success "npm $(npm -v) is installed"
}

# Install dependencies
install_dependencies() {
    print_status "Installing backend dependencies..."
    npm install
    
    print_status "Installing frontend dependencies..."
    cd client
    npm install
    cd ..
    
    print_success "All dependencies installed successfully"
}

# Setup environment
setup_environment() {
    print_status "Setting up environment configuration..."
    
    if [ ! -f .env ]; then
        if [ -f env.example ]; then
            cp env.example .env
            print_success "Environment file created from template"
        else
            print_error "env.example file not found"
            exit 1
        fi
    else
        print_warning "Environment file already exists"
    fi
    
    print_status "Please edit .env file with your configuration:"
    echo "  - Add your Alchemy API keys"
    echo "  - Add your private key (KEEP SECURE!)"
    echo "  - Configure contract addresses after deployment"
}

# Deploy contracts (optional)
deploy_contracts() {
    print_status "Checking if Hardhat is available..."
    
    if [ -f "hardhat.config.js" ]; then
        read -p "Do you want to deploy contracts to testnet? (y/N): " -n 1 -r
        echo
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_status "Installing Hardhat dependencies..."
            npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
            
            print_status "Deploying contracts to Goerli testnet..."
            npx hardhat run scripts/deploy.js --network goerli
            
            print_success "Contracts deployed successfully!"
            print_status "Please update .env file with the contract addresses"
        fi
    else
        print_warning "Hardhat configuration not found. Skipping contract deployment."
    fi
}

# Run tests
run_tests() {
    print_status "Running tests..."
    
    if [ -f "hardhat.config.js" ]; then
        npx hardhat test
        print_success "Tests completed successfully"
    else
        print_warning "Hardhat not configured. Skipping tests."
    fi
}

# Start development servers
start_development() {
    print_status "Starting development servers..."
    
    print_status "Starting backend server on port 5000..."
    npm run dev &
    BACKEND_PID=$!
    
    sleep 3
    
    print_status "Starting frontend server on port 3000..."
    cd client
    npm start &
    FRONTEND_PID=$!
    cd ..
    
    print_success "Development servers started!"
    echo
    echo "🌐 Frontend: http://localhost:3000"
    echo "🔧 Backend:  http://localhost:5000"
    echo "📊 API Health: http://localhost:5000/api/health"
    echo
    echo "Press Ctrl+C to stop servers"
    
    # Wait for user to stop servers
    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; print_status 'Servers stopped'; exit" INT
    wait
}

# Main execution
main() {
    echo
    print_status "Starting setup process..."
    
    # Check prerequisites
    check_nodejs
    check_npm
    
    # Install dependencies
    install_dependencies
    
    # Setup environment
    setup_environment
    
    # Deploy contracts (optional)
    deploy_contracts
    
    # Run tests
    run_tests
    
    echo
    print_success "Setup completed successfully!"
    echo
    echo "📋 Next Steps:"
    echo "1. Edit .env file with your configuration"
    echo "2. Deploy contracts if not done already"
    echo "3. Start development servers"
    echo
    echo "📚 Documentation: README.md"
    echo "🚀 Deployment Guide: DEPLOYMENT.md"
    echo
    
    read -p "Do you want to start development servers now? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        start_development
    else
        print_status "To start servers later, run:"
        echo "  npm run dev          # Backend"
        echo "  cd client && npm start  # Frontend"
    fi
}

# Run main function
main "$@" 