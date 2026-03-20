import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Quote } from "lucide-react";
import { motion } from "framer-motion";

export default function Login() {
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { isAdmin, isConfigured, isInitialized, login } = useAuth();
    const [, setLocation] = useLocation();

    useEffect(() => {
        if (isInitialized && isAdmin) {
            setLocation("/admin/reports");
        }
    }, [isAdmin, isInitialized, setLocation]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const result = await login(password);
            if (result.success) {
                setLocation("/admin/reports");
                return;
            }

            setError(result.message ?? "Invalid credentials");
        } finally {
            setIsSubmitting(false);
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
                        <p className="text-sm text-muted-foreground mt-2">Enter the server-managed admin password to access the review queue.</p>
                    </CardHeader>
                    <CardContent>
                        {!isConfigured && isInitialized && (
                            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                                Admin access is disabled until <code>ADMIN_PASSWORD</code> and <code>ADMIN_SESSION_SECRET</code> are set.
                            </div>
                        )}
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
                                    disabled={!isConfigured || isSubmitting}
                                    className={error ? "border-destructive focus-visible:ring-destructive" : ""}
                                />
                                {error && <p className="text-xs text-destructive font-medium">{error}</p>}
                            </div>
                            <Button
                                type="submit"
                                disabled={!isConfigured || isSubmitting}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                            >
                                {isSubmitting ? "Signing In..." : "Sign In"}
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
