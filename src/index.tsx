import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import DrivingSimulator from './driving_simulator';
import reportWebVitals from './reportWebVitals';

type MountOptions = {
  containerId?: string;
  container?: HTMLElement | null;
};

declare global {
  interface Window {
    startDrivingSimulator?: (options?: MountOptions) => void;
    unmountDrivingSimulator?: () => void;
  }
}

let activeRoot: ReactDOM.Root | null = null;
let activeContainer: Element | null = null;

const mountApp = (container: Element) => {
  if (activeRoot && activeContainer !== container) {
    activeRoot.unmount();
    activeRoot = null;
  }

  if (!activeRoot) {
    activeRoot = ReactDOM.createRoot(container);
    activeContainer = container;
  }

  activeRoot.render(<DrivingSimulator />);
};

const defaultContainer = document.getElementById('root');
if (defaultContainer) {
  mountApp(defaultContainer);
}

window.startDrivingSimulator = (options?: MountOptions) => {
  const container =
    options?.container ??
    (options?.containerId ? document.getElementById(options.containerId) : null) ??
    document.getElementById('root');

  if (!container) {
    console.error('startDrivingSimulator: unable to find container');
    return;
  }

  mountApp(container);
};

window.unmountDrivingSimulator = () => {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
    activeContainer = null;
  }
};
