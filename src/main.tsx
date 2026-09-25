import {createRoot} from 'react-dom/client';
import * as Cesium from 'cesium';
import App from './App.tsx';
import './index.css';

if (import.meta.env.VITE_CESIUM_ION_TOKEN) {
  Cesium.Ion.defaultAccessToken = (import.meta.env.VITE_CESIUM_ION_TOKEN as string).replace(/^<|>$/g, '').trim();
}

createRoot(document.getElementById('root')!).render(<App />);
