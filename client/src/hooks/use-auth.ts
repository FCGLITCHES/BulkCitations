import { useState, useEffect } from 'react';

export function useAuth() {
    const [isAdmin, setIsAdmin] = useState<boolean>(false);
    const [isInitialized, setIsInitialized] = useState<boolean>(false);

    useEffect(() => {
        // Read from localStorage on mount
        const storedAdminState = localStorage.getItem('bulkcitations_is_admin');
        if (storedAdminState === 'true') {
            setIsAdmin(true);
        }
        setIsInitialized(true);
    }, []);

    const login = (password: string) => {
        if (password === 'admin123') {
            setIsAdmin(true);
            localStorage.setItem('bulkcitations_is_admin', 'true');
            return true;
        }
        return false;
    };

    const logout = () => {
        setIsAdmin(false);
        localStorage.removeItem('bulkcitations_is_admin');
    };

    return { isAdmin, isInitialized, login, logout };
}
