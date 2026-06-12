import './tokens.css';
import './relay.css';
import { createRoot } from 'react-dom/client';
import { RelayApp } from './RelayApp';

const root = document.getElementById('relay-root');
if (root) createRoot(root).render(<RelayApp />);
