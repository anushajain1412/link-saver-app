// client/src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './components/Login.js';
import RegisterPage from './components/Register.js';
import Dashboard from './components/Dashboard.js'; // Your main dashboard for links
import './App.css'; // Your global styles

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            // In a real app, you'd verify the token with the backend
            // For simplicity here, we assume presence means authenticated
            setIsAuthenticated(true);
        }
        setLoading(false);
    }, []);

    const handleLogin = (token) => {
        localStorage.setItem('token', token);
        setIsAuthenticated(true);
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        setIsAuthenticated(false);
    };

    if (loading) {
        return <div>Loading...</div>; // Or a spinner
    }

    return (
        <Router>
            <div className="App">
                <Routes>
                    <Route
                        path="/login"
                        element={isAuthenticated ? <Navigate to="/dashboard" /> : <LoginPage onLogin={handleLogin} />}
                    />
                    <Route
                        path="/register"
                        element={isAuthenticated ? <Navigate to="/dashboard" /> : <RegisterPage />}
                    />
                    <Route
                        path="/dashboard"
                        element={isAuthenticated ? <Dashboard onLogout={handleLogout} /> : <Navigate to="/login" />}
                    />
                    <Route
                        path="/"
                        element={isAuthenticated ? <Navigate to="/dashboard" /> : <Navigate to="/login" />}
                    />
                </Routes>
            </div>
        </Router>
    );
}

export default App;