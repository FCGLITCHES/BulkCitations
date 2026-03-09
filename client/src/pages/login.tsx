import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "../hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Quote } from "lucide-react";
import { motion } from "framer-motion";

export default function Login() {
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const { login } = useAuth();
    const [, setLocation] = useLocation();

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (login(password)) {
            setLocation("/");
        } else {
            setError("Invalid password");
        }
    };

    return (
        <div className="min-h-screen bg-background font-sans flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="w-full max-w-md"
            >
                <div className="flex justify-center mb-8">
                    <Link href="/">
                        <div className="w-12 h-12 bg-gradient-brand rounded-xl flex items-center justify-center shadow-md hover:scale-105 transition-transform cursor-pointer">
                            <Quote className="text-white text-xl" />
                        </div>
                    </Link>
                </div>

                <Card className="shadow-xl border-border/50 bg-white/80 dark:bg-card/80 backdrop-blur-lg">
                    <CardHeader className="text-center pb-2">
                        <CardTitle className="text-2xl font-bold tracking-tight">Admin Login</CardTitle>
                        <p className="text-sm text-muted-foreground mt-2">Enter the admin passcode to access reports.</p>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="space-y-2">
                                <Input
                                    type="password"
                                    placeholder="Password"
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        setError("");
                                    }}
                                    className={error ? "border-destructive focus-visible:ring-destructive" : ""}
                                />
                                {error && <p className="text-xs text-destructive font-medium">{error}</p>}
                            </div>
                            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                                Sign In
                            </Button>
                        </form>
                        <div className="mt-6 text-center">
                            <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
                                &larr; Back to Home
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    );
}
