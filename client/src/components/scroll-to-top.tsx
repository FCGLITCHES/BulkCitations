import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";
import { motion, AnimatePresence, useScroll, useSpring } from "framer-motion";

export default function ScrollToTop() {
    const [isVisible, setIsVisible] = useState(false);
    const { scrollYProgress } = useScroll();
    const scaleX = useSpring(scrollYProgress, {
        stiffness: 100,
        damping: 30,
        restDelta: 0.001
    });

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
                    className="fixed bottom-6 right-6 z-50 group"
                >
                    <button
                        onClick={scrollToTop}
                        className="relative flex items-center justify-center h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-primary-container text-white shadow-2xl shadow-primary-container/30 hover:bg-[#002f5f] hover:scale-110 active:scale-95 transition-all duration-300 group"
                        aria-label="Scroll to top"
                    >
                        {/* Circular Progress Bar */}
                        <svg className="absolute inset-0 h-full w-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                            {/* Background track (semi-transparent) */}
                            <circle
                                cx="50"
                                cy="50"
                                r="46"
                                stroke="currentColor"
                                strokeWidth="6"
                                fill="transparent"
                                className="text-white/10"
                            />
                            {/* Progress path */}
                            <motion.circle
                                cx="50"
                                cy="50"
                                r="46"
                                stroke="currentColor"
                                strokeWidth="6"
                                fill="transparent"
                                strokeDasharray="289.027"
                                style={{
                                    pathLength: scrollYProgress,
                                    strokeLinecap: "round"
                                }}
                                className="text-white opacity-80"
                            />
                        </svg>

                        <ArrowUp className="h-5 w-5 sm:h-6 sm:w-6 relative z-10 transition-transform group-hover:-translate-y-1" />
                    </button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
