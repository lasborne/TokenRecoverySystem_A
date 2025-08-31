import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
// Buffer polyfill for some Solana libs in CRA
import { Buffer } from 'buffer';
if (!window.Buffer) {
  window.Buffer = Buffer;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
); 