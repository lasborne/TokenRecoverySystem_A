import React, { useState, useEffect, useRef } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import {
  Shield,
  Wallet,
  Activity,
  Settings,
  AlertTriangle,
  CheckCircle,
  Copy,
  Sun,
  Moon,
  Server,
  Wifi,
  WifiOff,
  ChevronDown,
  Github,
  Linkedin,
  Mail
} from 'lucide-react';
import axios from 'axios';
import { rescueNow as solanaRescue, closeAta as solanaCloseAta } from './solana/recovery';

// API configuration using environment variables
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// Helper function to map network keys to chain IDs
const networkToChainId = {
  mainnet: '0x1',
  base: '0x2105',
  polygon: '0x89',
  goerli: '0x5',
  linea: '0xe708',
  arbitrum: '0xa4b1',
  optimism: '0xa',
};

// Server health check function
async function checkServerHealth() {
  try {
    const response = await axios.get(`${API_BASE}/api/health`, { timeout: 5000 });
    return response.data?.status === 'ok';
  } catch (error) {
    return false;
  }
}

// Check if multi-recovery session is actually active on server
async function checkMultiRecoveryStatus(sessionId) {
  try {
    const response = await axios.get(`${API_BASE}/api/multi-recovery-status/${sessionId}`, { timeout: 5000 });
    return response.data?.active === true;
  } catch (error) {
    return false;
  }
}

async function switchWalletNetwork(networkKey) {
  if (window.ethereum && networkToChainId[networkKey]) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: networkToChainId[networkKey] }],
      });
    } catch (err) {
      if (err.code === 4902) {
        toast.error('Network not found in wallet. Please add it manually.');
      } else {
        toast.error('Failed to switch network: ' + (err.message || err));
      }
    }
  }
}

// Helper to extract a readable error message from any error object
function getErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error.response && error.response.data && error.response.data.error) return error.response.data.error;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// Main App component
function App() {
  // State management for the application
  const [activeTab, setActiveTab] = useState('register'); // Current active tab
  const [isLoading, setIsLoading] = useState(false); // Loading state for operations
  const [recoveries, setRecoveries] = useState([]); // List of active recoveries
  const [recoveryStatuses, setRecoveryStatuses] = useState({}); // {hackedWallet: {recoveredTokens: [...]}}
  const [formData, setFormData] = useState({ // Form data for registration
    hackedWallet: '',
    safeWallet: '',
    network: 'mainnet',
    nonce: '' // Add nonce to form state
  });

  // Server status state
  const [serverStatus, setServerStatus] = useState({
    isOnline: true,
    lastCheck: null,
    checking: false
  });

  // Add state for approval modal
  const [showApprove, setShowApprove] = useState(false);
  const [approveRecovery, setApproveRecovery] = useState(null);
  const [approveToken, setApproveToken] = useState('');
  const [approveLoading, setApproveLoading] = useState(false);
  const [approveError, setApproveError] = useState('');
  const [approveSuccess, setApproveSuccess] = useState('');

  const [autoRescueData, setAutoRescueData] = useState({
    hackedWalletPrivateKey: '',
    safeWallet: '',
    network: 'mainnet',
    nonce: '', // Add nonce to auto rescue state
    priorityTokens: [] // Array of priority token objects
  });
  const [autoRescueLoading, setAutoRescueLoading] = useState(false);
  const [autoRescueResult, setAutoRescueResult] = useState('');
  const [autoRescueSummary, setAutoRescueSummary] = useState([]);
  const [autoRescueError, setAutoRescueError] = useState('');
  const [autoRescueGasWarning, setAutoRescueGasWarning] = useState('');
  const [autoRescueGasCheckLoading, setAutoRescueGasCheckLoading] = useState(false);
  const [autoRescueGasBalance, setAutoRescueGasBalance] = useState(1); // Default to 1 to allow button to be clickable
	// Solana rescue state
	const [solanaForm, setSolanaForm] = useState({ secretInput: '', destination: '', rpcUrl: '' });
	const [solanaRunning, setSolanaRunning] = useState(false);
	const [solanaLogs, setSolanaLogs] = useState([]);
	const [showSolanaLogs, setShowSolanaLogs] = useState(true);
	const [closeAtaForm, setCloseAtaForm] = useState({ owner: '', mint: '', rentTo: '' });
	const [closingAta, setClosingAta] = useState(false);
	const [showCloseAtaSection, setShowCloseAtaSection] = useState(false);
	const [solanaCancelFlag, setSolanaCancelFlag] = useState(false);
	const [showSolanaStatus, setShowSolanaStatus] = useState(false);
	const solanaLoopCancelRef = useRef(false);
	const [solanaStopping, setSolanaStopping] = useState(false);

	// Reuse server status from ETH section for consistency

	// Helper: derive Solana public key from the secret provided above
	const deriveOwnerFromSecret = async () => {
		try {
			const sec = (solanaForm.secretInput || '').trim();
			if (!sec) throw new Error('Enter Solana secret first');
			const { Keypair } = await import('@solana/web3.js');
			const bs58 = (await import('bs58')).default;
			const kp = sec.startsWith('[')
				? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(sec)))
				: Keypair.fromSecretKey(bs58.decode(sec));
			return kp.publicKey.toBase58();
		} catch (e) {
			throw new Error(e?.message || 'Could not derive owner from secret');
		}
	};
  
  // Priority token management
  const [priorityTokenInput, setPriorityTokenInput] = useState({
    contractAddress: '',
    network: 'mainnet',
    priority: 'normal' // 'normal' | 'maximum'
  });
  const [showPriorityTokenForm, setShowPriorityTokenForm] = useState(false);
  
  // Advanced settings dropdown
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // Multi-network auto-rescue controls (client app)
  const [recoveryMode, setRecoveryMode] = useState('single'); // 'single' | 'multi'
  const [multiConfig, setMultiConfig] = useState({
    runOnAllNetworks: false,
    targetNetworks: [],
    intervalSeconds: 30,
  });
  const [multiStartLoading, setMultiStartLoading] = useState(false);
  const [multiStopLoading, setMultiStopLoading] = useState(false);
  const [activeMultiSession, setActiveMultiSession] = useState(null); // { sessionId, networks }
  const [/* multiRecoveryStatus */, setMultiRecoveryStatus] = useState({
    isActive: false,
    lastCheck: null,
    checking: false
  });

  // Initialize gas check state on component mount
  useEffect(() => {
    console.log('Component mounted - initializing gas check state');
    setAutoRescueGasCheckLoading(false);
    setAutoRescueGasBalance(1);
  }, []);

  // Add state to control visibility of autoRescueSummary log
  const [showAutoRescueSummary, setShowAutoRescueSummary] = useState(true);

  const [connectedAddress, setConnectedAddress] = useState('');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  useEffect(() => {
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    // Warn if multiple wallet extensions are detected
    if (typeof window !== 'undefined' && window.ethereum && Array.isArray(window.ethereum.providers) && window.ethereum.providers.length > 1) {
      toast.error('Multiple Ethereum wallet extensions detected. Please disable all but one (e.g., MetaMask) to avoid provider conflicts.');
    }
    if (showApprove && window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
        setConnectedAddress(accounts[0] || '');
      });
      window.ethereum.on && window.ethereum.on('accountsChanged', (accounts) => {
        setConnectedAddress(accounts[0] || '');
      });
    }
    // eslint-disable-next-line
  }, [showApprove]);

  // Fetch active recoveries on component mount
  useEffect(() => {
    fetchActiveRecoveries();
  }, []);

  // Fetch recovery status for all recoveries
  useEffect(() => {
    async function fetchStatuses() {
      const statuses = {};
      for (const rec of recoveries) {
        try {
          const resp = await axios.get(`${API_BASE}/api/recovery-status/${rec.hackedWallet}`);
          statuses[rec.hackedWallet] = resp.data;
        } catch (e) {
          // ignore
        }
      }
      setRecoveryStatuses(statuses);
    }
    if (recoveries.length > 0) fetchStatuses();
  }, [recoveries]);

  // Check gas balance when private key or network changes (with debounce)
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      async function checkGas() {
        console.log('Checking gas balance...', { 
          privateKey: autoRescueData.hackedWalletPrivateKey ? 'present' : 'missing', 
          network: autoRescueData.network,
          loadingState: autoRescueGasCheckLoading 
        });
        setAutoRescueGasWarning('');
        
        // Only check gas if we have both private key and network
        if (!autoRescueData.hackedWalletPrivateKey || !autoRescueData.network) {
          console.log('Gas check skipped - missing private key or network');
          setAutoRescueGasBalance(1); // Allow button to be clickable
          setAutoRescueGasCheckLoading(false); // Ensure loading is false
          return;
        }
        
        setAutoRescueGasCheckLoading(true);
        console.log('Gas check loading set to true');
        
        try {
          // Add timeout to prevent hanging
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
          
          const resp = await axios.post(`${API_BASE}/api/check-balance`, {
            hackedWalletPrivateKey: autoRescueData.hackedWalletPrivateKey,
            network: autoRescueData.network
          }, { signal: controller.signal });
          
          clearTimeout(timeoutId);
          
          const bal = parseFloat(resp.data.balanceEth);
          setAutoRescueGasBalance(bal);
          console.log('Gas balance checked:', bal);
          
          if (bal === 0) {
            setAutoRescueGasWarning('Error: Hacked wallet has zero native token balance. You must fund it with ETH (or the network native token) to pay for gas before rescue can succeed.');
          } else if (bal < 0.0001) {
            setAutoRescueGasWarning('Warning: Hacked wallet has low native token balance. You may need to fund it with more ETH (or the network native token) to ensure rescue succeeds.');
          } else {
            setAutoRescueGasWarning(''); // Clear any previous warnings
          }
        } catch (e) {
          console.log('Gas check error:', e.message);
          if (e.name === 'AbortError') {
            setAutoRescueGasWarning('Gas check timed out. Proceed with caution.');
          } else {
            setAutoRescueGasWarning('Could not check wallet balance. Proceed with caution.');
          }
          setAutoRescueGasBalance(1); // Allow button to be clickable even if check fails
        } finally {
          setAutoRescueGasCheckLoading(false);
          console.log('Gas check loading set to false');
        }
      }
      checkGas();
    }, 1000); // Debounce for 1 second

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line
  }, [autoRescueData.hackedWalletPrivateKey, autoRescueData.network]);

  // Reset showAutoRescueSummary to true whenever a new rescue is performed (i.e., when autoRescueSummary changes and is non-empty)
  useEffect(() => {
    if (autoRescueSummary.length > 0) setShowAutoRescueSummary(true);
  }, [autoRescueSummary]);

  // Server health checking
  useEffect(() => {
    const performHealthCheck = async () => {
      setServerStatus(prev => ({ ...prev, checking: true }));
      try {
        const isOnline = await checkServerHealth();
        setServerStatus({
          isOnline,
          lastCheck: new Date(),
          checking: false
        });
        
        // If server is down and we think recovery is active, update the status
        if (!isOnline && activeMultiSession) {
          setActiveMultiSession(null);
          setMultiRecoveryStatus({
            isActive: false,
            lastCheck: new Date(),
            checking: false
          });
          toast.error('Server connection lost. Auto-recovery has been stopped.');
        }
      } catch (error) {
        setServerStatus({
          isOnline: false,
          lastCheck: new Date(),
          checking: false
        });
      }
    };

    // Check immediately
    performHealthCheck();

    // Set up periodic health checks every 30 seconds
    const healthCheckInterval = setInterval(performHealthCheck, 30000);

    return () => clearInterval(healthCheckInterval);
  }, [activeMultiSession]);

  // Check multi-recovery status when we have an active session
  useEffect(() => {
    const performMultiRecoveryStatusCheck = async () => {
      if (!activeMultiSession?.sessionId) return;
      
      setMultiRecoveryStatus(prev => ({ ...prev, checking: true }));
      try {
        const isActive = await checkMultiRecoveryStatus(activeMultiSession.sessionId);
        setMultiRecoveryStatus({
          isActive,
          lastCheck: new Date(),
          checking: false
        });
        
        // If recovery is not actually active on server, update local state
        if (!isActive && activeMultiSession) {
          setActiveMultiSession(null);
          toast.error('Auto-recovery session has ended on the server.');
        }
      } catch (error) {
        setMultiRecoveryStatus({
          isActive: false,
          lastCheck: new Date(),
          checking: false
        });
        
        // If we can't check status and server is down, assume recovery stopped
        if (!serverStatus.isOnline) {
          setActiveMultiSession(null);
        }
      }
    };

    if (activeMultiSession?.sessionId) {
      performMultiRecoveryStatusCheck();
      
      // Check status every 15 seconds when we have an active session
      const statusCheckInterval = setInterval(performMultiRecoveryStatusCheck, 15000);
      return () => clearInterval(statusCheckInterval);
    }
  }, [activeMultiSession, serverStatus.isOnline]);

  /**
   * Fetch all active recoveries from the backend
   */
  const fetchActiveRecoveries = async () => {
    try {
      const response = await axios.get(`${API_BASE}/api/active-recoveries`);
      setRecoveries(response.data);
    } catch (error) {
      console.error('Error fetching recoveries:', error);
      toast.error('Failed to fetch active recoveries');
    }
  };

  /**
   * Handle form input changes
   * @param {Event} e - The input change event
   */
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    console.log(`Input changed: ${name} = ${value}`);
    setFormData(prev => {
      const newData = {
        ...prev,
        [name]: value
      };
      console.log('Updated form data:', newData);
      return newData;
    });
    if (name === 'network') {
      switchWalletNetwork(value);
    }
  };

  /**
   * Validate wallet address format
   * @param {string} address - The wallet address to validate
   * @returns {boolean} - True if valid, false otherwise
   */
  const isValidAddress = (address) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  /**
   * Register a new recovery
   */
  const handleRegisterRecovery = async (e) => {
    e.preventDefault();
    console.log('Form submitted!');
    console.log('Form data:', formData);
    
    // Validate form data
    if (!isValidAddress(formData.hackedWallet)) {
      console.log('Invalid hacked wallet address:', formData.hackedWallet);
      toast.error('Invalid hacked wallet address');
      return;
    }
    
    if (!isValidAddress(formData.safeWallet)) {
      console.log('Invalid safe wallet address:', formData.safeWallet);
      toast.error('Invalid safe wallet address');
      return;
    }
    
    if (formData.hackedWallet === formData.safeWallet) {
      console.log('Same wallet addresses');
      toast.error('Hacked wallet and safe wallet must be different');
      return;
    }

    setIsLoading(true);
    
    try {
      console.log('Sending registration request:', formData);
      
      // First, test if the backend is reachable
      try {
        const healthCheck = await axios.get(`${API_BASE}/api/health`, { timeout: 5000 });
        console.log('Backend health check:', healthCheck.data);
      } catch (healthError) {
        console.error('Backend health check failed:', healthError);
        toast.error('Backend server is not reachable. Please check if the server is running.');
        return;
      }
      
      const payload = { ...formData };
      if (payload.nonce === '' || payload.nonce === undefined) {
        delete payload.nonce;
      } else {
        payload.nonce = Number(payload.nonce);
      }
      const response = await axios.post(`${API_BASE}/api/register-recovery`, payload, {
        timeout: 120000 // 2 minutes timeout
      });
      console.log('Registration response:', response.data);
      
      if (response.data.success) {
        toast.success('Recovery registered successfully!');
        setFormData({ hackedWallet: '', safeWallet: '', network: 'mainnet' });
        fetchActiveRecoveries(); // Refresh the list
        setActiveTab('monitor'); // Switch to monitor tab
      } else if (response.data.error) {
        toast.error(response.data.error);
      }
    } catch (error) {
      console.error('Registration error:', error);
      if (error.code === 'ECONNABORTED') {
        toast.error('Linea network is slow or congested. Please try again later.');
      } else if (error.response && error.response.data && error.response.data.error) {
        toast.error(error.response.data.error);
      } else {
        toast.error('An unknown error occurred. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Deactivate a recovery
   * @param {string} hackedWallet - The hacked wallet address
   * @param {string} network - The blockchain network
   */
  const handleDeactivateRecovery = async (hackedWallet, network) => {
    if (!window.confirm('Are you sure you want to deactivate this recovery?')) {
      return;
    }

    try {
      console.log('Deactivating recovery with data:', { hackedWallet, network });
      console.log('Recovery object being deactivated:', { hackedWallet, network });
      
              await axios.post(`${API_BASE}/api/deactivate-recovery`, { hackedWallet, network });
      toast.success('Recovery deactivated successfully');
      fetchActiveRecoveries();
    } catch (error) {
      console.error('Deactivation error:', error);
      console.error('Error response:', error.response?.data);
      toast.error('Failed to deactivate recovery');
    }
  };

  /**
   * Copy text to clipboard
   * @param {string} text - The text to copy
   */
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
  };

  /**
   * Format wallet address for display
   * @param {string} address - The wallet address
   * @returns {string} - Formatted address
   */
  const formatAddress = (address) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  /**
   * Get network display name
   * @param {string} network - The network identifier
   * @returns {string} - Display name
   */
  const getNetworkName = (network) => {
    const networks = {
      mainnet: 'Ethereum Mainnet',
      base: 'Base Mainnet',
      polygon: 'Polygon',
      goerli: 'Goerli Testnet',
      linea: 'Linea Mainnet',
      arbitrum: 'Arbitrum Mainnet',
      optimism: 'Optimism Mainnet'
    };
    return networks[network] || network;
  };

  /**
   * Get status color for recovery
   * @param {Object} recovery - The recovery object
   * @returns {string} - Tailwind color class
   */
  const getStatusColor = (recovery) => {
    if (!recovery.isActive) return 'text-red-400';
    const lastCheck = new Date(recovery.lastCheck);
    const now = new Date();
    const diffMinutes = (now - lastCheck) / (1000 * 60);
    
    if (diffMinutes < 5) return 'text-green-400';
    if (diffMinutes < 30) return 'text-yellow-400';
    return 'text-red-400';
  };

  // Approve function using MetaMask
  async function handleApproveToken() {
    setApproveError(''); 
    setApproveSuccess('');
    setApproveLoading(true);
    if (!window.ethereum) {
      setApproveError('MetaMask not detected');
      setApproveLoading(false);
      return;
    }
    if (!approveToken || !approveRecovery) {
      setApproveError('Token address and contract address required');
      setApproveLoading(false);
      return;
    }
    try {
      setApproveLoading(true);
      console.log('Approve Modal Debug:', {
        approveToken,
        approveRecovery,
        network: formData.network
      });
      
      const ethersLib = (await import('ethers')).ethers;
      const MaxUint256 = ethersLib.MaxUint256;
      const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const ethersProvider = new ethersLib.BrowserProvider(window.ethereum);
      const signer = await ethersProvider.getSigner();
      
      // Add debugging information about the token contract
      try {
        const debugContract = new ethersLib.Contract(approveToken, [
          "function name() view returns (string)",
          "function symbol() view returns (string)",
          "function supportsInterface(bytes4 interfaceId) view returns (bool)"
        ], ethersProvider);
        
        const [tokenName, tokenSymbol] = await Promise.all([
          debugContract.name().catch(() => 'Unknown'),
          debugContract.symbol().catch(() => 'Unknown')
        ]);
        
        console.log('Token contract details:', {
          address: approveToken,
          name: tokenName,
          symbol: tokenSymbol
        });
      } catch (debugError) {
        console.log('Could not get token contract details:', debugError.message);
      }
      
      // Detect token type (ERC20 vs ERC721)
      const erc20Abi = [
        "function approve(address spender, uint256 amount) public returns (bool)",
        "function balanceOf(address owner) view returns (uint256)",
        "function transfer(address to, uint256 amount) public returns (bool)",
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)"
      ];
      
      const erc721Abi = [
        "function approve(address to, uint256 tokenId) public",
        "function setApprovalForAll(address operator, bool approved) public",
        "function balanceOf(address owner) view returns (uint256)",
        "function ownerOf(uint256 tokenId) view returns (address)",
        "function transferFrom(address from, address to, uint256 tokenId) public",
        "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
        "function tokenByIndex(uint256 index) view returns (uint256)",
        "function totalSupply() view returns (uint256)",
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
      ];
      
      let tokenType = 'unknown';
      let tokenContract;
      
      // Try to detect token type by checking for ERC721-specific functions
      try {
        // First try ERC721 - check for ownerOf function which is unique to ERC721
        const erc721TestContract = new ethersLib.Contract(approveToken, [
          "function ownerOf(uint256 tokenId) view returns (address)",
          "function name() view returns (string)"
        ], signer);
        
        // Try to call ownerOf with token ID 1 - if this works, it's ERC721
        try {
          await erc721TestContract.ownerOf(1);
          tokenType = 'ERC721';
          tokenContract = new ethersLib.Contract(approveToken, erc721Abi, signer);
          console.log('Detected ERC721 token');
        } catch (ownerError) {
          // If ownerOf fails, it might be ERC20 or the token ID doesn't exist
          // Try ERC20 approach
          tokenContract = new ethersLib.Contract(approveToken, erc20Abi, signer);
          await tokenContract.decimals(); // This is unique to ERC20
          tokenType = 'ERC20';
          console.log('Detected ERC20 token');
        }
      } catch (error) {
        // If both fail, try a more comprehensive check
        try {
          const testContract = new ethersLib.Contract(approveToken, [
            "function supportsInterface(bytes4 interfaceId) view returns (bool)",
            "function name() view returns (string)"
          ], signer);
          
          // Check for ERC721 interface support
          const erc721InterfaceId = '0x80ac58cd'; // ERC721 interface ID
          const isERC721 = await testContract.supportsInterface(erc721InterfaceId);
          
          if (isERC721) {
            tokenType = 'ERC721';
            tokenContract = new ethersLib.Contract(approveToken, erc721Abi, signer);
            console.log('Detected ERC721 token via interface check');
          } else {
            tokenType = 'ERC20';
            tokenContract = new ethersLib.Contract(approveToken, erc20Abi, signer);
            console.log('Detected ERC20 token via interface check');
          }
        } catch (finalError) {
          console.log('Interface detection failed, trying fallback approach...');
          
          // Fallback: Try to determine by attempting the approval methods
          try {
            // Try ERC20 approve first
            const erc20FallbackContract = new ethersLib.Contract(approveToken, [
              "function approve(address spender, uint256 amount) public returns (bool)"
            ], signer);
            
            // Try to estimate gas for ERC20 approve
            await erc20FallbackContract.approve.populateTransaction(approveRecovery, MaxUint256);
            tokenType = 'ERC20';
            tokenContract = new ethersLib.Contract(approveToken, erc20Abi, signer);
            console.log('Detected ERC20 token via fallback method');
          } catch (erc20Error) {
            try {
              // Try ERC721 setApprovalForAll
              const erc721FallbackContract = new ethersLib.Contract(approveToken, [
                "function setApprovalForAll(address operator, bool approved) public"
              ], signer);
              
              // Try to estimate gas for ERC721 setApprovalForAll
              await erc721FallbackContract.setApprovalForAll.populateTransaction(approveRecovery, true);
              tokenType = 'ERC721';
              tokenContract = new ethersLib.Contract(approveToken, erc721Abi, signer);
              console.log('Detected ERC721 token via fallback method');
            } catch (erc721Error) {
              throw new Error('Unable to determine token type. The contract may not support standard ERC20 or ERC721 interfaces.');
            }
          }
        }
      }
      
      if (tokenType === 'ERC20') {
        // Handle ERC20 token approval
        const tx = await tokenContract.approve(approveRecovery, MaxUint256);
        await tx.wait();
        setApproveSuccess('ERC20 approval for maximum amount successful!');
        setApproveLoading('transferring');
        
        // Transfer ERC20 tokens
        const recovery = recoveries.find(r => r.hackedWallet === approveRecovery);
        if (!recovery || !recovery.safeWallet) {
          toast.error('Safe wallet not found for this recovery.');
          setApproveLoading(false);
          return;
        }
        
        const balance = await tokenContract.balanceOf(account);
        if (balance > 0n) {
          const transferTx = await tokenContract.transfer(recovery.safeWallet, balance);
          await transferTx.wait();
          toast.success('ERC20 tokens transferred to safe wallet!');
        } else {
          toast.error('No ERC20 token balance to transfer.');
        }
      } else if (tokenType === 'ERC721') {
        // Handle ERC721 token approval
        const recovery = recoveries.find(r => r.hackedWallet === approveRecovery);
        if (!recovery || !recovery.safeWallet) {
          toast.error('Safe wallet not found for this recovery.');
          setApproveLoading(false);
          return;
        }
        
        // Get user's NFT balance
        const balance = await tokenContract.balanceOf(account);
        if (balance === 0n) {
          toast.error('No NFTs found in your wallet.');
          setApproveLoading(false);
          return;
        }
        
        console.log(`Found ${balance} NFTs in wallet for ERC721 token ${approveToken}`);
        
        // For ERC721, we need to approve the recovery contract to transfer all NFTs
        // Use setApprovalForAll instead of individual approvals
        const approveAllTx = await tokenContract.setApprovalForAll(approveRecovery, true);
        await approveAllTx.wait();
        setApproveSuccess('ERC721 approval for all tokens successful!');
        
        // Now transfer all NFTs to the safe wallet
        setApproveLoading('transferring');
        console.log('Starting ERC721 NFT transfer to safe wallet...');
        
        // Add a timeout to prevent hanging
        const transferTimeout = setTimeout(() => {
          console.log('Transfer operation timed out');
          setApproveLoading(false);
          toast.error('Transfer operation timed out. Please try again or transfer manually.');
        }, 30000); // 30 second timeout
        
        try {
          // Get all token IDs owned by the user
          const tokenIds = [];
          for (let i = 0; i < Number(balance); i++) {
            try {
              // Try to get token ID by index (some contracts support this)
              const tokenId = await tokenContract.tokenOfOwnerByIndex(account, i);
              tokenIds.push(tokenId);
            } catch (error) {
              // If tokenOfOwnerByIndex is not supported, we need a different approach
              console.log(`Could not get token ID at index ${i}, trying alternative method...`);
              break;
            }
          }
          
          // If we couldn't get token IDs by index, try alternative methods
          if (tokenIds.length === 0) {
            console.log('tokenOfOwnerByIndex not supported, trying alternative methods...');
            
            // Try to get token IDs using a more efficient approach
            try {
              // First, try to get recent transfer events to find owned tokens
              console.log('Trying to find owned tokens via events...');
              
              // Get the current block number
              const currentBlock = await ethersProvider.getBlockNumber();
              const fromBlock = Math.max(0, currentBlock - 10000); // Look back 10k blocks
              
              // Try to get Transfer events where the user is the recipient
              try {
                const transferFilter = tokenContract.filters.Transfer(null, account);
                const transferEvents = await tokenContract.queryFilter(transferFilter, fromBlock, currentBlock);
                
                console.log(`Found ${transferEvents.length} transfer events to user`);
                
                // Extract unique token IDs from transfer events
                const eventTokenIds = new Set();
                for (const event of transferEvents) {
                  if (event.args && event.args.tokenId) {
                    eventTokenIds.add(event.args.tokenId.toString());
                  }
                }
                
                // Check which of these tokens are still owned by the user
                for (const tokenId of eventTokenIds) {
                  try {
                    const owner = await tokenContract.ownerOf(tokenId);
                    if (owner.toLowerCase() === account.toLowerCase()) {
                      tokenIds.push(tokenId);
                      console.log(`Found owned token ID via events: ${tokenId}`);
                    }
                  } catch (error) {
                    // Token might not exist anymore
                    continue;
                  }
                }
              } catch (eventError) {
                console.log('Event-based detection failed:', eventError);
              }
              
              // If events didn't work, try a limited range scan
              if (tokenIds.length === 0) {
                console.log('Event detection failed, trying limited range scan...');
                
                // Try scanning a limited range instead of the entire supply
                const maxScanRange = 1000; // Limit to 1000 tokens max
                let scanRange = Math.min(Number(balance) * 10, maxScanRange); // Scan 10x the balance or max 1000
                
                console.log(`Scanning limited range: 0 to ${scanRange}`);
                
                for (let i = 0; i < scanRange; i++) {
                  try {
                    const tokenId = await tokenContract.tokenByIndex(i);
                    const owner = await tokenContract.ownerOf(tokenId);
                    
                    if (owner.toLowerCase() === account.toLowerCase()) {
                      tokenIds.push(tokenId);
                      console.log(`Found owned token ID via scan: ${tokenId}`);
                      
                      // If we found all the tokens we expect, stop scanning
                      if (tokenIds.length >= Number(balance)) {
                        break;
                      }
                    }
                  } catch (error) {
                    // Skip this token if there's an error
                    continue;
                  }
                }
              }
            } catch (error) {
              console.log('Alternative token ID detection failed:', error);
            }
          }
          
          // If we still don't have token IDs, try using the recovery contract
          if (tokenIds.length === 0) {
            console.log('No token IDs found, trying recovery contract transfer...');
            
            // Call the recovery contract to transfer NFTs
            const recoveryContract = new ethersLib.Contract(approveRecovery, [
              "function transferERC721(address tokenContract, address from, address to) external",
              "function transferAllERC721(address tokenContract, address from, address to) external"
            ], signer);
            
            try {
              // Try to call transferAllERC721 if it exists
              const transferTx = await recoveryContract.transferAllERC721(approveToken, account, recovery.safeWallet);
              await transferTx.wait();
              toast.success(`All ${balance} NFTs transferred to safe wallet!`);
              clearTimeout(transferTimeout);
            } catch (transferError) {
              console.log('Recovery contract transfer failed:', transferError);
              
              // Since the recovery contract doesn't support ERC721, we'll try a different approach
              // We can try to transfer directly from the user's wallet to the safe wallet
              console.log('Trying direct transfer from user wallet...');
              
              try {
                // Try to transfer directly using the user's wallet
                // This requires the user to have approved the NFTs for transfer
                const directTransferTx = await tokenContract.transferFrom(account, recovery.safeWallet, 0); // Try token ID 0
                await directTransferTx.wait();
                toast.success('NFT transferred to safe wallet!');
                clearTimeout(transferTimeout);
              } catch (directError) {
                console.log('Direct transfer also failed:', directError);
                
                // If all methods fail, provide clear instructions to the user
                toast.success('ERC721 approval completed. Please manually transfer your NFTs to the safe wallet.');
                console.log('All transfer methods failed. Manual transfer required.');
                
                // Show a more detailed message to the user
                setApproveSuccess(`ERC721 approval successful! You have ${balance} NFTs. Please manually transfer them to: ${recovery.safeWallet}`);
              }
            }
          } else {
            // Transfer each NFT individually
            console.log(`Transferring ${tokenIds.length} NFTs...`);
            let transferredCount = 0;
            
            for (const tokenId of tokenIds) {
              try {
                const transferTx = await tokenContract.transferFrom(account, recovery.safeWallet, tokenId);
                await transferTx.wait();
                transferredCount++;
                console.log(`Transferred NFT with ID ${tokenId}`);
              } catch (transferError) {
                console.error(`Failed to transfer NFT with ID ${tokenId}:`, transferError);
              }
            }
            
            if (transferredCount > 0) {
              toast.success(`${transferredCount} NFTs transferred to safe wallet!`);
            } else {
              toast.error('Failed to transfer any NFTs. Manual transfer may be required.');
            }
            clearTimeout(transferTimeout);
          }
        } catch (transferError) {
          console.error('ERC721 transfer error:', transferError);
          toast.error('NFT transfer failed. Manual transfer may be required.');
        } finally {
          clearTimeout(transferTimeout);
        }
      } else {
        setApproveError('Unknown token type detected');
        setApproveLoading(false);
        return;
      }
      
      setApproveLoading(false);
    } catch (e) {
      console.error('Approval process error:', e);
      setApproveLoading(false);
      
      if (e.response && e.response.data && e.response.data.error) {
        setApproveError(e.response.data.error);
      } else {
        setApproveError(e.message || 'Approval failed');
      }
    }
  }

  // Place this function above the return statement, near other handlers
  const handleAutoRescueInputChange = (e) => {
    const { name, value } = e.target;
    setAutoRescueData(prev => ({
      ...prev,
      [name]: value
    }));
    if (name === 'network') {
      switchWalletNetwork(value);
    }
  };

  // Tab configuration
  const tabs = [
    { id: 'register', label: 'Register Recovery', icon: Shield },
    { id: 'monitor', label: 'Monitor Recoveries', icon: Activity },
    { id: 'autoRescue', label: 'Auto Rescue', icon: AlertTriangle },
    { id: 'solana', label: 'Solana Rescue', icon: Server },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  return (
    <div className={`min-h-screen transition-colors duration-300 ${theme === 'dark' ? 'bg-dark-900' : 'bg-blue-50'}`}>
      {/* Toast notifications */}
      <Toaster 
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: theme === 'dark' ? '#1e293b' : '#e0e7ff',
            color: theme === 'dark' ? '#fff' : '#1e293b',
            border: `1px solid ${theme === 'dark' ? '#475569' : '#93c5fd'}`
          }
        }}
      />

      {/* Header */}
      <header className={`border-b ${theme === 'dark' ? 'bg-dark-800 border-dark-700' : 'bg-blue-100 border-blue-200'} transition-colors duration-300`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${theme === 'dark' ? 'bg-primary-600' : 'bg-blue-500'}`}> <Shield className="w-5 h-5 text-white" /> </div>
              <h1 className={`text-xl font-bold ${theme === 'dark' ? 'gradient-text' : 'text-blue-800'}`}>Token Recovery System</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={`p-2 rounded-full border ${theme === 'dark' ? 'border-dark-700' : 'border-blue-300'} hover:bg-blue-200 transition-colors`}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun className="w-5 h-5 text-yellow-300" /> : <Moon className="w-5 h-5 text-blue-700" />}
              </button>
              <div className="flex items-center space-x-2 text-sm">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
                <span className="text-green-500 font-semibold">Bot Active</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className={`border-b ${theme === 'dark' ? 'bg-dark-800 border-dark-700' : 'bg-blue-50 border-blue-200'} transition-colors duration-300`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors duration-200 ${
                    activeTab === tab.id
                      ? (theme === 'dark' ? 'border-primary-500 text-primary-400' : 'border-blue-500 text-blue-700')
                      : (theme === 'dark' ? 'border-transparent text-dark-400 hover:text-dark-300 hover:border-dark-600' : 'border-transparent text-blue-400 hover:text-blue-700 hover:border-blue-300')
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Register Recovery Tab */}
        {activeTab === 'register' && (
          <div className="space-y-8">
            {/* Hero Section */}
            <div className="text-center space-y-4">
              <h2 className="text-3xl font-bold gradient-text">
                Recover Tokens From Compromised Wallets
              </h2>
              <p className="text-dark-400 max-w-2xl mx-auto text-balance">
                Recover assets and protect future airdrops by registering your compromised wallet. 
                Our automated system monitors, rescues, and transfers tokens to your safe wallet across EVM and Solana.
              </p>
            </div>

            {/* Registration Form */}
            <div className="max-w-2xl mx-auto">
              <div className={`card ${theme === 'dark' ? 'bg-dark-800 border-dark-700' : 'bg-white border-blue-200'} rounded-xl shadow-lg p-6 transition-colors duration-300`}>
                <form onSubmit={handleRegisterRecovery} className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-dark-300 mb-2">
                      Hacked Wallet Address
                    </label>
                    <input
                      type="text"
                      name="hackedWallet"
                      value={formData.hackedWallet}
                      onChange={handleInputChange}
                      placeholder="0x..."
                      className="input-field w-full"
                      required
                    />
                    <p className="text-xs text-dark-500 mt-1">
                      The wallet address that was compromised
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-300 mb-2">
                      Safe Wallet Address
                    </label>
                    <input
                      type="text"
                      name="safeWallet"
                      value={formData.safeWallet}
                      onChange={handleInputChange}
                      placeholder="0x..."
                      className="input-field w-full"
                      required
                    />
                    <p className="text-xs text-dark-500 mt-1">
                      The wallet where recovered funds will be sent
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-300 mb-2">
                      Nonce (advanced, optional)
                    </label>
                    <input
                      type="number"
                      name="nonce"
                      value={formData.nonce}
                      onChange={handleInputChange}
                      placeholder="Leave blank for automatic"
                      className="input-field w-full"
                      min="0"
                    />
                    <p className="text-xs text-dark-500 mt-1">
                      Specify a nonce to override a pending transaction (advanced users only)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-300 mb-2">
                      Blockchain Network
                    </label>
                    <select
                      name="network"
                      value={formData.network}
                      onChange={handleInputChange}
                      className="input-field w-full"
                    >
                      <option value="mainnet">Ethereum Mainnet</option>
                      <option value="base">Base Mainnet</option>
                      <option value="polygon">Polygon</option>
                      <option value="linea">Linea Mainnet</option>
                      <option value="arbitrum">Arbitrum Mainnet</option>
                      <option value="optimism">Optimism Mainnet</option>
                      <option value="goerli">Goerli Testnet</option>
                    </select>
                  </div>

                  {/* Debug: Show current form data */}
                  <div className="text-xs text-dark-500 bg-dark-700 p-2 rounded">
                    <strong>Debug - Current Form Data:</strong><br/>
                    Hacked Wallet: {formData.hackedWallet || 'empty'}<br/>
                    Safe Wallet: {formData.safeWallet || 'empty'}<br/>
                    Network: {formData.network || 'empty'}
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="btn-primary w-full flex items-center justify-center space-x-2"
                    onClick={() => console.log('Button clicked!')}
                  >
                    {isLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Registering...</span>
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        <span>Register Recovery</span>
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* Security Notice */}
            <div className="max-w-2xl mx-auto">
              <div className={`rounded-lg p-4 border ${theme === 'dark' ? 'bg-yellow-900/20 border-yellow-700' : 'bg-yellow-100 border-yellow-300'}`}>
                <div className="flex items-start space-x-3">
                  <AlertTriangle className={`mt-0.5 ${theme === 'dark' ? 'w-5 h-5 text-yellow-400' : 'w-5 h-5 text-yellow-600'}`} />
                  <div className="text-sm">
                    <h3 className={`font-medium mb-1 ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-700'}`}>Security Notice</h3>
                    <p className={theme === 'dark' ? 'text-dark-300' : 'text-blue-900'}>
                      This system requires access to your private keys for automated claiming. 
                      Ensure you're using this on a secure, trusted environment. Never share 
                      your private keys with anyone.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Monitor Recoveries Tab */}
        {activeTab === 'monitor' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold gradient-text">
                Active Recoveries
              </h2>
              <button
                onClick={fetchActiveRecoveries}
                className="btn-secondary flex items-center space-x-2"
              >
                <Activity className="w-4 h-4" />
                <span>Refresh</span>
              </button>
            </div>

            {recoveries.length === 0 ? (
              <div className="text-center py-12">
                <Wallet className="w-16 h-16 text-dark-600 mx-auto mb-4" />
                <h3 className="text-xl font-medium text-dark-300 mb-2">
                  No Active Recoveries
                </h3>
                <p className="text-dark-500 mb-6">
                  Register a recovery to start monitoring and rescuing tokens automatically
                </p>
                <button
                  onClick={() => setActiveTab('register')}
                  className="btn-primary"
                >
                  Register Recovery
                </button>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {recoveries.map((recovery, index) => (
                  <div key={index} className="card">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(recovery).replace('text-', 'bg-')}`}></div>
                        <span className="text-sm font-medium text-dark-300">
                          {recovery.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <span className="text-xs text-dark-500 bg-dark-700 px-2 py-1 rounded">
                        {getNetworkName(recovery.network)}
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-xs text-dark-500">Hacked Wallet</label>
                        <div className="flex items-center space-x-2">
                          <code className="text-sm font-mono text-dark-300">
                            {formatAddress(recovery.hackedWallet)}
                          </code>
                          <button
                            onClick={() => copyToClipboard(recovery.hackedWallet)}
                            className="text-dark-500 hover:text-dark-300"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs text-dark-500">Safe Wallet</label>
                        <div className="flex items-center space-x-2">
                          <code className="text-sm font-mono text-dark-300">
                            {formatAddress(recovery.safeWallet)}
                          </code>
                          <button
                            onClick={() => copyToClipboard(recovery.safeWallet)}
                            className="text-dark-500 hover:text-dark-300"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-dark-500">Recovered Tokens:</span>
                        <ul className="text-xs font-mono text-dark-300">
                          {(recoveryStatuses[recovery.hackedWallet]?.recoveredTokens || []).filter(token => {
                            // Only show if token balance in hacked wallet is zero
                            if (!token.address) return false;
                            if (token.address === '0x0000000000000000000000000000000000000000') return false; // Hide ETH unless actually transferred
                            const hackedWalletBalance = token.balance || 0;
                            return hackedWalletBalance === 0 || hackedWalletBalance === '0';
                          }).length === 0 && (
                            <li>No tokens recovered yet</li>
                          )}
                          {(recoveryStatuses[recovery.hackedWallet]?.recoveredTokens || []).filter(token => {
                            if (!token.address) return false;
                            if (token.address === '0x0000000000000000000000000000000000000000') return false;
                            const hackedWalletBalance = token.balance || 0;
                            return hackedWalletBalance === 0 || hackedWalletBalance === '0';
                          }).map((token, i) => (
                            <li key={i}>
                              {parseFloat(token.amount) / Math.pow(10, token.decimals || 18)} {token.symbol || 'TOKEN'}
                              <span className="ml-2 text-dark-500">({token.address.slice(0, 6)}...{token.address.slice(-4)})</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-dark-500">Last Check:</span>
                        <span className="text-dark-300">
                          {new Date(recovery.lastCheck).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    {recovery.isActive && (
                      <button
                        onClick={() => handleDeactivateRecovery(recovery.hackedWallet, recovery.network)}
                        className="btn-danger w-full mt-4"
                      >
                        Deactivate Recovery
                      </button>
                    )}
                    <button
                      className="btn-primary w-full mt-2"
                      onClick={() => {
                        setApproveRecovery(recovery.hackedWallet);
                        setShowApprove(true);
                                                      setApproveToken('');
                              setApproveError('');
                        setApproveSuccess('');
                      }}
                    >
                      Approve Token for Recovery
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Auto Rescue Tab */}
        {activeTab === 'autoRescue' && (
          <div className="space-y-8 max-w-xl mx-auto">
            <div className={`rounded-lg p-4 mb-4 border ${theme === 'dark' ? 'bg-yellow-900/20 border-yellow-700' : 'bg-yellow-100 border-yellow-300'}`}>
              <AlertTriangle className={`inline-block mr-2 ${theme === 'dark' ? 'w-5 h-5 text-yellow-400' : 'w-5 h-5 text-yellow-600'}`} />
              <span className={`font-medium ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-700'}`}>Security Warning:</span>
              <span className={theme === 'dark' ? 'text-dark-300 ml-2' : 'text-blue-900 ml-2'}>Only use this if your wallet is already compromised and you are trying to rescue funds. Your private key is used only for this rescue operation and is never stored.</span>
            </div>
            <form
              className="card space-y-6"
              onSubmit={async e => {
                e.preventDefault();
                setAutoRescueResult('');
                setAutoRescueError('');
                setAutoRescueSummary([]);

                if (recoveryMode === 'multi') {
                  // Check server status before starting
                  if (!serverStatus.isOnline) {
                    setAutoRescueError('Cannot start multi-network recovery: Server is offline. Please wait for the server to come back online.');
                    return;
                  }

                  // Start multi-network auto recovery session
                  setMultiStartLoading(true);
                  try {
                    let targetNetworks = multiConfig.targetNetworks || [];
                    if (!multiConfig.runOnAllNetworks && !targetNetworks.includes(autoRescueData.network)) {
                      targetNetworks = [autoRescueData.network, ...targetNetworks];
                    }

                    const sessionPayload = {
                      hackedWalletPrivateKey: autoRescueData.hackedWalletPrivateKey,
                      safeWallet: autoRescueData.safeWallet,
                      primaryNetwork: autoRescueData.network,
                      runOnAllNetworks: multiConfig.runOnAllNetworks,
                      targetNetworks,
                      intervalSeconds: multiConfig.intervalSeconds,
                      priorityTokens: autoRescueData.priorityTokens || [],
                    };

                    const resp = await axios.post(`${API_BASE}/api/start-multi-recovery`, sessionPayload);
                    if (resp.data?.success) {
                      setActiveMultiSession({ sessionId: resp.data.sessionId, networks: resp.data.networks });
                      setAutoRescueResult(resp.data.message || 'Multi-network recovery started');
                    } else {
                      setAutoRescueError(getErrorMessage(resp.data));
                    }
                  } catch (err) {
                    const errorMsg = getErrorMessage(err);
                    if (err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK') {
                      setAutoRescueError('Server connection failed. Please check if the server is running and try again.');
                    } else {
                      setAutoRescueError(errorMsg);
                    }
                  } finally {
                    setMultiStartLoading(false);
                  }
                } else {
                  // Check server status before starting
                  if (!serverStatus.isOnline) {
                    setAutoRescueError('Cannot start auto-rescue: Server is offline. Please wait for the server to come back online.');
                    return;
                  }

                  // Single network auto rescue
                  setAutoRescueLoading(true);
                  try {
                    const payload = { ...autoRescueData };
                    if (payload.nonce === '' || payload.nonce === undefined) {
                      delete payload.nonce;
                    } else {
                      payload.nonce = Number(payload.nonce);
                    }
                    const resp = await axios.post(`${API_BASE}/api/auto-rescue`, payload);
                    setAutoRescueResult(resp.data.message || 'Rescue complete!');
                    setAutoRescueSummary(resp.data.summary || []);
                    setAutoRescueData({ hackedWalletPrivateKey: '', safeWallet: '', network: 'mainnet', nonce: '', priorityTokens: [] });
                  } catch (err) {
                    const errorMsg = getErrorMessage(err);
                    if (err.code === 'ECONNREFUSED' || err.code === 'ERR_NETWORK') {
                      setAutoRescueError('Server connection failed. Please check if the server is running and try again.');
                    } else {
                      setAutoRescueError(errorMsg);
                    }
                  } finally {
                    setAutoRescueLoading(false);
                  }
                }
              }}
            >
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">Hacked Wallet Private Key</label>
                <input
                  type="password"
                  name="hackedWalletPrivateKey"
                  value={autoRescueData.hackedWalletPrivateKey}
                  onChange={handleAutoRescueInputChange}
                  className="input-field w-full"
                  required
                />
                <p className="text-xs text-dark-500 mt-1">Never share your private key unless you trust this rescue service.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">Safe Wallet Address</label>
                <input
                  type="text"
                  name="safeWallet"
                  value={autoRescueData.safeWallet}
                  onChange={handleAutoRescueInputChange}
                  className="input-field w-full"
                  required
                />
              </div>
              {/* Primary Network */}
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">Blockchain Network</label>
                <select
                  name="network"
                  value={autoRescueData.network}
                  onChange={handleAutoRescueInputChange}
                  className="input-field w-full"
                >
                  <option value="mainnet">Ethereum Mainnet</option>
                  <option value="base">Base Mainnet</option>
                  <option value="polygon">Polygon</option>
                  <option value="linea">Linea Mainnet</option>
                  <option value="arbitrum">Arbitrum Mainnet</option>
                  <option value="optimism">Optimism Mainnet</option>
                  <option value="goerli">Goerli Testnet</option>
                </select>
              </div>

              {/* Advanced Settings Dropdown */}
              <div className="rounded-lg border border-dark-700">
                <button
                  type="button"
                  onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                  className="w-full p-4 flex items-center justify-between text-left hover:bg-dark-800/50 transition-colors"
                >
                  <div className="flex items-center space-x-2">
                    <Settings className="w-4 h-4 text-dark-400" />
                    <span className="text-sm font-medium text-dark-300">Advanced Settings</span>
                    {autoRescueData.priorityTokens.length > 0 && (
                      <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded-full">
                        {autoRescueData.priorityTokens.length} Priority Token{autoRescueData.priorityTokens.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {recoveryMode === 'multi' && (
                      <span className="text-xs bg-green-500 text-white px-2 py-1 rounded-full">Multi-Network</span>
                    )}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-dark-400 transition-transform ${showAdvancedSettings ? 'rotate-180' : ''}`} />
                </button>

                {showAdvancedSettings && (
                  <div className="p-4 border-t border-dark-700 space-y-4">
                    {/* Priority Token Management */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-dark-300">Priority Token Management</h3>
                        <button
                          type="button"
                          onClick={() => setShowPriorityTokenForm(!showPriorityTokenForm)}
                          className="btn-secondary text-xs"
                        >
                          {showPriorityTokenForm ? 'Hide' : 'Add Priority Token'}
                        </button>
                      </div>

                      {showPriorityTokenForm && (
                        <div className="space-y-3 p-3 bg-dark-800/50 rounded border border-dark-600">
                          <div>
                            <label className="block text-xs text-dark-400 mb-1">Token Contract Address</label>
                            <input
                              type="text"
                              value={priorityTokenInput.contractAddress}
                              onChange={(e) => setPriorityTokenInput(prev => ({ ...prev, contractAddress: e.target.value }))}
                              placeholder="0x..."
                              className="input-field w-full text-sm"
                            />
                          </div>
                          
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-dark-400 mb-1">Network</label>
                              <select
                                value={priorityTokenInput.network}
                                onChange={(e) => setPriorityTokenInput(prev => ({ ...prev, network: e.target.value }))}
                                className="input-field w-full text-sm"
                              >
                                <option value="mainnet">Ethereum Mainnet</option>
                                <option value="base">Base Mainnet</option>
                                <option value="polygon">Polygon</option>
                                <option value="linea">Linea Mainnet</option>
                                <option value="arbitrum">Arbitrum Mainnet</option>
                                <option value="optimism">Optimism Mainnet</option>
                                <option value="goerli">Goerli Testnet</option>
                              </select>
                            </div>
                            
                            <div>
                              <label className="block text-xs text-dark-400 mb-1">Priority</label>
                              <select
                                value={priorityTokenInput.priority}
                                onChange={(e) => setPriorityTokenInput(prev => ({ ...prev, priority: e.target.value }))}
                                className="input-field w-full text-sm"
                              >
                                <option value="normal">Normal Priority</option>
                                <option value="maximum">Maximum Priority</option>
                              </select>
                            </div>
                          </div>

                          <div className="flex space-x-2">
                            <button
                              type="button"
                              onClick={() => {
                                if (priorityTokenInput.contractAddress.trim()) {
                                  setAutoRescueData(prev => ({
                                    ...prev,
                                    priorityTokens: [...prev.priorityTokens, { ...priorityTokenInput }]
                                  }));
                                  setPriorityTokenInput({
                                    contractAddress: '',
                                    network: 'mainnet',
                                    priority: 'normal'
                                  });
                                }
                              }}
                              className="btn-primary text-xs flex-1"
                              disabled={!priorityTokenInput.contractAddress.trim()}
                            >
                              Add Token
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowPriorityTokenForm(false)}
                              className="btn-secondary text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Display Priority Tokens */}
                      {autoRescueData.priorityTokens.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs text-dark-400 mb-2">Priority Tokens ({autoRescueData.priorityTokens.length})</div>
                          <div className="space-y-2 max-h-32 overflow-y-auto">
                            {autoRescueData.priorityTokens.map((token, index) => (
                              <div key={index} className="flex items-center justify-between p-2 bg-dark-800/30 rounded border border-dark-600">
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-dark-300 truncate">{token.contractAddress}</div>
                                  <div className="text-xs text-dark-500">{getNetworkName(token.network)} • {token.priority === 'maximum' ? 'Max Priority' : 'Normal Priority'}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAutoRescueData(prev => ({
                                      ...prev,
                                      priorityTokens: prev.priorityTokens.filter((_, i) => i !== index)
                                    }));
                                  }}
                                  className="text-red-400 hover:text-red-300 text-xs ml-2"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Multi-Network Protection */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-dark-300">Multi-Network Protection</h3>
                        {recoveryMode === 'multi' && (
                          <span className="text-xs text-green-400 bg-green-900/30 px-2 py-1 rounded">Recommended</span>
                        )}
                      </div>
                      
                      <div className="flex items-center space-x-2 mb-3">
                        <input
                          type="checkbox"
                          id="enableMulti"
                          checked={recoveryMode === 'multi'}
                          onChange={() => setRecoveryMode(recoveryMode === 'multi' ? 'single' : 'multi')}
                        />
                        <label htmlFor="enableMulti" className="text-sm text-dark-300">Enable Multi-Network Protection</label>
                      </div>

                      {recoveryMode === 'multi' && (
                        <div className="space-y-3 p-3 bg-dark-800/50 rounded border border-dark-600">
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={multiConfig.runOnAllNetworks}
                              onChange={(e) => setMultiConfig(prev => ({ ...prev, runOnAllNetworks: e.target.checked }))}
                            />
                            <span className="text-sm text-dark-300">Run on all supported networks</span>
                          </label>

                          {!multiConfig.runOnAllNetworks && (
                            <div>
                              <div className="text-xs text-dark-400 mb-2">Select additional networks (primary included automatically)</div>
                              <div className="grid grid-cols-2 gap-2">
                                {['mainnet','base','polygon','linea','arbitrum','optimism','goerli']
                                  .filter(n => n !== autoRescueData.network)
                                  .map(n => (
                                    <label key={n} className="flex items-center space-x-2 text-sm">
                                      <input
                                        type="checkbox"
                                        checked={multiConfig.targetNetworks.includes(n)}
                                        onChange={() => setMultiConfig(prev => ({
                                          ...prev,
                                          targetNetworks: prev.targetNetworks.includes(n)
                                            ? prev.targetNetworks.filter(t => t !== n)
                                            : [...prev.targetNetworks, n]
                                        }))}
                                      />
                                      <span className="text-dark-300">{getNetworkName(n)}</span>
                                    </label>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-dark-400 mb-1">Interval (seconds)</label>
                              <input
                                type="number"
                                min={10}
                                max={300}
                                value={multiConfig.intervalSeconds}
                                onChange={(e) => setMultiConfig(prev => ({ ...prev, intervalSeconds: Math.min(300, Math.max(10, parseInt(e.target.value) || 30)) }))}
                                className="input-field w-full"
                              />
                            </div>
                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={() => setMultiConfig({ runOnAllNetworks: true, targetNetworks: [], intervalSeconds: 30 })}
                                className="btn-secondary w-full"
                              >
                                Max Protection
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Nonce Setting */}
                    <div>
                      <h3 className="text-sm font-medium text-dark-300 mb-2">Transaction Nonce</h3>
                      <input
                        type="number"
                        name="nonce"
                        value={autoRescueData.nonce}
                        onChange={handleAutoRescueInputChange}
                        placeholder="Leave blank for automatic"
                        className="input-field w-full"
                        min="0"
                      />
                      <p className="text-xs text-dark-500 mt-1">
                        Specify a nonce to override a pending transaction (advanced users only)
                      </p>
                    </div>

                    {/* Status Indicators removed from ETH/L2 section by request */}
                  </div>
                )}
              </div>




              {autoRescueError && (
                <div
                  style={{
                    maxHeight: '120px',
                    overflowY: 'auto',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                    color: '#f87171', // Tailwind red-400
                    fontSize: '0.85em',
                    background: '#fff0f0',
                    borderRadius: '4px',
                    padding: '6px',
                    marginTop: '8px'
                  }}
                >
                  {autoRescueError}
                </div>
              )}
              {autoRescueResult && <div className="text-green-400 text-xs">{autoRescueResult}</div>}
              {showAutoRescueSummary && autoRescueSummary.length > 0 && (
                <div className="relative bg-dark-900 border border-dark-700 rounded p-3 mt-2 text-xs text-dark-200 space-y-1">
                  <button
                    className="absolute top-2 right-2 text-dark-400 hover:text-red-400 text-lg font-bold focus:outline-none"
                    onClick={() => setShowAutoRescueSummary(false)}
                    aria-label="Close log"
                    title="Close log"
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    &times;
                  </button>
                  <div className="mb-2 font-semibold text-dark-300">Rescue Log</div>
                  <ul>
                    {autoRescueSummary.map((line, i) => (
                      <li key={i}>• {line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!showAutoRescueSummary && autoRescueSummary.length > 0 && (
                <button
                  className="mt-2 px-3 py-1 bg-dark-800 border border-dark-700 rounded text-xs text-dark-300 hover:bg-dark-700 transition-colors"
                  onClick={() => setShowAutoRescueSummary(true)}
                  aria-label="Show log"
                  title="Show rescue log"
                >
                  Show Log
                </button>
              )}
              {autoRescueGasWarning && (
                <div className={`text-xs mb-2 ${autoRescueGasBalance === 0 ? 'text-red-400' : 'text-yellow-400'}`}>
                  {autoRescueGasWarning}
                  {autoRescueGasBalance === 0 && (
                    <div className="mt-1 text-red-300">
                      ⚠️ Button disabled: Add ETH to the hacked wallet to enable rescue
                    </div>
                  )}
                </div>
              )}
              {autoRescueGasCheckLoading && (
                <div className="text-xs mb-2 text-yellow-400">
                  🔄 Checking wallet balance...
                  <button 
                    onClick={() => {
                      console.log('Manual reset of gas check loading');
                      setAutoRescueGasCheckLoading(false);
                      setAutoRescueGasBalance(1);
                    }}
                    className="ml-2 text-blue-400 hover:text-blue-300 underline"
                  >
                    Reset
                  </button>
                </div>
              )}



              {/* Action Buttons */}
              <div className="flex items-center space-x-3">
                <button
                  type="submit"
                  className="btn-primary flex-1 flex items-center justify-center space-x-2"
                  disabled={
                    !serverStatus.isOnline || 
                    (recoveryMode === 'single' && (autoRescueLoading || autoRescueGasCheckLoading || autoRescueGasBalance === 0)) || 
                    (recoveryMode === 'multi' && multiStartLoading)
                  }
                  onClick={() => {
                    console.log('Auto Rescue button clicked!', { 
                      autoRescueData, 
                      autoRescueLoading, 
                      autoRescueGasCheckLoading, 
                      autoRescueGasBalance,
                      serverStatus: serverStatus.isOnline
                    });
                    
                    // Show error if server is offline
                    if (!serverStatus.isOnline) {
                      toast.error('Cannot start recovery: Server is offline. Please wait for the server to come back online.');
                      return;
                    }
                    
                    // Force reset loading state if stuck
                    if (autoRescueGasCheckLoading) {
                      console.log('Forcing reset of stuck loading state');
                      setAutoRescueGasCheckLoading(false);
                    }
                  }}
                >
                  {!serverStatus.isOnline ? (
                    <>
                      <WifiOff className="w-4 h-4" />
                      <span>Server Offline</span>
                    </>
                  ) : recoveryMode === 'multi' ? (
                    multiStartLoading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Starting...</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4" />
                        <span>Start Multi-Network Recovery</span>
                      </>
                    )
                  ) : autoRescueLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Rescuing...</span>
                    </>
                  ) : autoRescueGasBalance === 0 ? (
                    <>
                      <AlertTriangle className="w-4 h-4" />
                      <span>No ETH for Gas</span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4" />
                      <span>Auto Rescue</span>
                    </>
                  )}
                </button>

                {/* Stop/Cancel Button */}
                {(autoRescueLoading || activeMultiSession) && (
                  <button
                    type="button"
                    className="btn-secondary px-4"
                    disabled={multiStopLoading}
                    onClick={async () => {
                      try {
                        if (activeMultiSession) {
                          setMultiStopLoading(true);
                          if (serverStatus.isOnline) {
                            await axios.post(`${API_BASE}/api/stop-multi-recovery`, { sessionId: activeMultiSession.sessionId });
                          }
                          setActiveMultiSession(null);
                          setMultiRecoveryStatus({
                            isActive: false,
                            lastCheck: new Date(),
                            checking: false
                          });
                        } else {
                          if (serverStatus.isOnline) {
                            await axios.post(`${API_BASE}/api/cancel-auto-rescue`);
                          }
                          setAutoRescueLoading(false);
                        }
                      } catch (err) {
                        console.error('Stop/Cancel error:', err);
                        // Even if server call fails, update local state
                        if (activeMultiSession) {
                          setActiveMultiSession(null);
                          setMultiRecoveryStatus({
                            isActive: false,
                            lastCheck: new Date(),
                            checking: false
                          });
                        } else {
                          setAutoRescueLoading(false);
                        }
                      } finally {
                        setMultiStopLoading(false);
                      }
                    }}
                  >
                    {multiStopLoading ? 'Stopping...' : 'Stop'}
                  </button>
                )}
              </div>
            </form>

            
          </div>
        )}

        {/* Solana Rescue Tab */}
        {activeTab === 'solana' && (
          <div className="space-y-8 max-w-xl mx-auto">
            <div className={`rounded-lg p-4 mb-4 border ${theme === 'dark' ? 'bg-yellow-900/20 border-yellow-700' : 'bg-yellow-100 border-yellow-300'}`}>
              <AlertTriangle className={`${theme === 'dark' ? 'w-5 h-5 text-yellow-400' : 'w-5 h-5 text-yellow-600'} inline-block mr-2`} />
              <span className={`font-medium ${theme === 'dark' ? 'text-yellow-400' : 'text-yellow-700'}`}>Client-side only:</span>
              <span className={theme === 'dark' ? 'text-dark-300 ml-2' : 'text-blue-900 ml-2'}>Your Solana secret never leaves your browser. Use on a secure device.</span>
            </div>
            <form
              className="card space-y-6"
              onSubmit={async e => {
                e.preventDefault();
                setSolanaLogs([]);
                setSolanaRunning(true);
                setSolanaStopping(false);
                solanaLoopCancelRef.current = false;
                try {
                  const onLog = (m) => setSolanaLogs(prev => [...prev, String(m)]);
                  while (!solanaLoopCancelRef.current) {
                    if (!serverStatus.isOnline) {
                      onLog('Server offline; pausing Solana rescue loop...');
                      await new Promise(r => setTimeout(r, 2000));
                      continue;
                    }
                    const ok = await solanaRescue({
                      secretInput: solanaForm.secretInput,
                      destinationAddress: solanaForm.destination,
                      rpcUrl: solanaForm.rpcUrl,
                      onLog,
                      shouldCancel: () => solanaCancelFlag
                    });
                    if (!ok) break;
                    await new Promise(r => setTimeout(r, 1500));
                  }
                  // Only show completion toast if loop stopped naturally (e.g., user cancelled triggers its own feedback)
                  if (!solanaLoopCancelRef.current) toast.success('Solana rescue loop finished');
                } catch (err) {
                  toast.error(err?.message || 'Solana rescue failed');
                } finally {
                  setSolanaRunning(false);
                  setSolanaCancelFlag(false);
                  setSolanaStopping(false);
                }
              }}
            >
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">Compromised Wallet Secret</label>
                <textarea
                  name="secretInput"
                  value={solanaForm.secretInput}
                  onChange={(e) => setSolanaForm(prev => ({ ...prev, secretInput: e.target.value }))}
                  className="input-field w-full h-28"
                  placeholder="Base58 secret key or JSON [..bytes..]"
                  required
                />
                <p className="text-xs text-dark-500 mt-1">Handled locally. Accepts base58 or JSON Uint8Array.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">Safe Solana Address</label>
                <input
                  type="text"
                  name="destination"
                  value={solanaForm.destination}
                  onChange={(e) => setSolanaForm(prev => ({ ...prev, destination: e.target.value }))}
                  className="input-field w-full"
                  placeholder="Destination (safe) SOL address"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">RPC URL (optional)</label>
                <input
                  type="text"
                  name="rpcUrl"
                  value={solanaForm.rpcUrl}
                  onChange={(e) => setSolanaForm(prev => ({ ...prev, rpcUrl: e.target.value }))}
                  className="input-field w-full"
                  placeholder="Defaults to mainnet-beta"
                />
              </div>
              <div className="flex items-center space-x-3">
                <button type="submit" className="btn-primary flex-1 flex items-center justify-center space-x-2" disabled={solanaRunning}>
                  {solanaRunning ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Rescuing...</span>
                    </>
                  ) : (
                    <>
                      <Server className="w-4 h-4" />
                      <span>Run Solana Rescue</span>
                    </>
                  )}
                </button>
                {solanaRunning && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={solanaStopping}
                    onClick={() => {
                      if (!solanaStopping) {
                        setSolanaStopping(true);
                        setSolanaCancelFlag(true);
                        solanaLoopCancelRef.current = true;
                        setSolanaLogs(prev => [...prev, 'Stopping Solana rescue...']);
                        toast('Stopping Solana rescue...');
                      }
                    }}
                  >
                    {solanaStopping ? 'Stopping...' : 'Stop'}
                  </button>
                )}
              </div>
              {solanaLogs.length > 0 && (
                <div className="relative bg-dark-900 border border-dark-700 rounded p-3 mt-2 text-xs text-dark-200 space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-semibold text-dark-300">Solana Log</div>
                    <div className="flex items-center gap-2">
                      <button className="btn-secondary text-[11px]" onClick={() => setShowSolanaLogs(s => !s)}>
                        {showSolanaLogs ? 'Hide' : 'Show'}
                      </button>
                      <button className="btn-danger text-[11px]" onClick={() => setSolanaLogs([])}>Clear</button>
                    </div>
                  </div>
                  {showSolanaLogs && (
                    <ul>
                      {solanaLogs.map((line, i) => (
                        <li key={i}>• {line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </form>

            {/* System Status (collapsible) */}
            <div className={`rounded-lg p-4 border ${theme === 'dark' ? 'bg-dark-800 border-dark-700' : 'bg-white border-blue-200'}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-dark-300">System Status</h3>
                <button type="button" className="btn-secondary text-xs" onClick={() => setShowSolanaStatus(s => !s)}>
                  {showSolanaStatus ? 'Hide' : 'Show'}
                </button>
              </div>
              {showSolanaStatus && (
                <div className="mt-3">
                  <div className="flex items-center justify-between p-3 bg-dark-800 border border-dark-700 rounded-lg">
                    <div className="flex items-center space-x-2">
                      {serverStatus.checking ? (
                        <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
                      ) : serverStatus.isOnline ? (
                        <Wifi className="w-4 h-4 text-green-400" />
                      ) : (
                        <WifiOff className="w-4 h-4 text-red-400" />
                      )}
                      <span className="text-sm text-dark-300">Server Status:</span>
                      <span className={`text-sm font-medium ${serverStatus.isOnline ? 'text-green-400' : 'text-red-400'}`}>
                        {serverStatus.checking ? 'Checking...' : serverStatus.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    {serverStatus.lastCheck && (
                      <span className="text-xs text-dark-500">Last check: {new Date(serverStatus.lastCheck).toLocaleTimeString()}</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Close ATA Section */}
            <div className={`rounded-lg p-4 border ${theme === 'dark' ? 'bg-dark-800 border-dark-700' : 'bg-white border-blue-200'}`}>
				<div className="flex items-center justify-between">
					<h3 className="text-lg font-semibold">Close Associated Token Account (ATA)</h3>
					<button type="button" className="btn-secondary text-xs" onClick={() => setShowCloseAtaSection(s => !s)}>
						{showCloseAtaSection ? 'Hide' : 'Show'}
					</button>
				</div>
				{showCloseAtaSection && (
				<div className="grid gap-3 mt-3">
					<div>
						<label className="block text-xs text-dark-500 mb-1">Owner (ATA owner) address</label>
						<div className="flex gap-2">
							<input className="input-field w-full" placeholder="Owner wallet address (derived from your secret)" value={closeAtaForm.owner} onChange={e => setCloseAtaForm(prev => ({ ...prev, owner: e.target.value }))} />
							<button type="button" className="btn-secondary whitespace-nowrap" onClick={async () => {
								try { const owner = await deriveOwnerFromSecret(); setCloseAtaForm(prev => ({ ...prev, owner })); toast.success('Owner set from secret'); }
								catch (e) { toast.error(e.message); }
							}}>Use my wallet</button>
						</div>
					</div>
					<div>
						<label className="block text-xs text-dark-500 mb-1">Mint address</label>
						<input className="input-field w-full" placeholder="Token (mint) address of the token previously transferred" value={closeAtaForm.mint} onChange={e => setCloseAtaForm(prev => ({ ...prev, mint: e.target.value }))} />
					</div>
					<div>
						<label className="block text-xs text-dark-500 mb-1">Rent recipient (defaults to owner)</label>
						<input className="input-field w-full" placeholder="Address to receive reclaimed SOL" value={closeAtaForm.rentTo} onChange={e => setCloseAtaForm(prev => ({ ...prev, rentTo: e.target.value }))} />
					</div>

					<button
						className="btn-secondary"
						disabled={closingAta}
						onClick={async () => {
							setClosingAta(true);
							try {
								const onLog = (m) => setSolanaLogs(prev => [...prev, String(m)]);
								const ownerResolved = closeAtaForm.owner || await deriveOwnerFromSecret();
								await solanaCloseAta({
									secretInput: solanaForm.secretInput,
									rpcUrl: solanaForm.rpcUrl,
									ownerAddress: ownerResolved,
									mintAddress: closeAtaForm.mint,
									rentRecipientAddress: closeAtaForm.rentTo || ownerResolved,
									onLog
								});
								toast.success('ATA closed and rent reclaimed');
							} catch (err) {
								toast.error(err?.message || 'Close ATA failed');
							} finally {
								setClosingAta(false);
							}
						}}
					>
						{closingAta ? 'Closing...' : 'Close ATA'}
					</button>
				</div>
				)}
			</div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="space-y-8">
            <h2 className="text-2xl font-bold gradient-text">
              System Settings
            </h2>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Bot Status */}
              <div className="card">
                <h3 className="text-lg font-medium mb-4">Claim Bot Status</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-dark-300">Status</span>
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                      <span className="text-green-400 text-sm">Active</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-dark-300">Check Interval</span>
                    <span className="text-dark-300 text-sm">30 seconds</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-dark-300">Active Recoveries</span>
                    <span className="text-dark-300 text-sm">{recoveries.length}</span>
                  </div>
                </div>
              </div>

              {/* Network Configuration */}
              <div className="card">
                <h3 className="text-lg font-medium mb-4">Supported Networks</h3>
                <div className="space-y-3">
                  {Object.entries({
                    mainnet: 'Ethereum Mainnet',
                    base: 'Base Mainnet',
                    polygon: 'Polygon',
                    linea: 'Linea Mainnet',
                    arbitrum: 'Arbitrum Mainnet',
                    optimism: 'Optimism Mainnet',
                    goerli: 'Goerli Testnet'
                  }).map(([key, name]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-dark-300">{name}</span>
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    </div>
                  ))}
                </div>
              </div>

              {/* System Info */}
              <div className="card md:col-span-2">
                <h3 className="text-lg font-medium mb-4">System Information</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm text-dark-500">Contract Version</label>
                    <p className="text-dark-300">v1.0.0</p>
                  </div>
                  <div>
                    <label className="text-sm text-dark-500">Last Update</label>
                    <p className="text-dark-300">{new Date().toLocaleDateString()}</p>
                  </div>
                  <div>
                    <label className="text-sm text-dark-500">Security Level</label>
                    <p className="text-green-400">High</p>
                  </div>
                  <div>
                    <label className="text-sm text-dark-500">Uptime</label>
                    <p className="text-dark-300">99.9%</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-dark-800 border-t border-dark-700 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center text-dark-400 text-sm">
            <p>
              Token Recovery System - Secure recovery for compromised wallets (EVM & Solana)
            </p>
            <p className="mt-2">
              Built with React, Ethers.js, and Solidity for maximum security
            </p>
            <div className="mt-4 flex items-center justify-center gap-4">
              <a
                href="https://github.com/lasborne"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 hover:text-white"
                aria-label="GitHub Profile"
              >
                <Github className="w-5 h-5" />
                <span className="underline">github.com/lasborne</span>
              </a>
              <a
                href="mailto:okeke.michael1000@gmail.com"
                className="inline-flex items-center gap-2 hover:text-white"
                aria-label="Email Support"
              >
                <Mail className="w-5 h-5" />
                <span className="underline">okeke.michael1000@gmail.com</span>
              </a>
              <a
                href="https://www.linkedin.com/in/okeke-michael-87b3008a/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 hover:text-white"
                aria-label="LinkedIn Profile"
              >
                <Linkedin className="w-5 h-5" />
                <span className="underline">linkedin.com/in/okeke-michael-87b3008a/</span>
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Approve Modal/Section */}
      {showApprove && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
          <div className="bg-dark-800 p-6 rounded-lg w-full max-w-md relative">
            <button className="absolute top-2 right-2 text-dark-400" onClick={() => setShowApprove(false)}>&times;</button>
            <h3 className="text-lg font-bold mb-4">Approve Token for Recovery</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-dark-500">Token Address</label>
                <input
                  type="text"
                  className="input-field w-full"
                  value={approveToken}
                  onChange={e => setApproveToken(e.target.value)}
                  placeholder="0x..."
                />
              </div>
              <div>
                <label className="text-xs text-dark-500">Recovery Contract Address</label>
                <input
                  type="text"
                  className="input-field w-full bg-dark-700"
                  value={process.env.REACT_APP_RECOVERY_CONTRACT_ADDRESS || 'Set in .env'}
                  readOnly
                />
              </div>
              {approveError && (
                <div
                  style={{
                    maxHeight: '120px',
                    overflowY: 'auto',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                    color: '#f87171', // Tailwind red-400
                    fontSize: '0.85em',
                    background: '#fff0f0',
                    borderRadius: '4px',
                    padding: '6px',
                    marginTop: '8px'
                  }}
                >
                  {approveError}
                </div>
              )}
              {approveSuccess && <div className="text-green-400 text-xs">{approveSuccess}</div>}
              {approveRecovery && connectedAddress && connectedAddress.toLowerCase() !== approveRecovery.toLowerCase() && (
                <div className="text-red-400 text-xs">
                  Please connect MetaMask as the hacked wallet ({approveRecovery}) to approve.
                </div>
              )}
              <button
                className="btn-primary w-full mt-2"
                onClick={handleApproveToken}
                disabled={approveLoading}
              >
                {approveLoading === true ? 'Approving...' : approveLoading === 'transferring' ? 'Transferring...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App; 