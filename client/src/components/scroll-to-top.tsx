import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ScrollToTop() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const toggleVisibility = () => {
            if (window.scrollY > 300) {
                setIsVisible(true);
            } else {
                setIsVisible(false);
            }
        };

        window.addEventListener("scroll", toggleVisibility);
        return () => window.removeEventListener("scroll", toggleVisibility);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    };

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.8, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8, y: 20 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                    className="fixed bottom-6 right-2 sm:bottom-8 sm:right-2 z-50"
                >
                    <Button
                        variant="default"
                        size="icon"
                        onClick={scrollToTop}
                        className="rounded-full shadow-xl shadow-primary/20 h-10 w-10 sm:h-12 sm:w-12 bg-primary hover:bg-primary/90 hover:scale-105 transition-all text-primary-foreground border border-primary/20"
                        aria-label="Scroll to top"
                    >
                        <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5 relative bottom-[1px]" />
                    </Button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
