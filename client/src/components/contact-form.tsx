import { useState } from "react";
import { useForm } from "react-hook-form";
import { cn } from "@/lib/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  Send, 
  Mail, 
  MessageSquare, 
  Sparkles, 
  Bug, 
  Heart,
  User,
  CheckCircle2
} from "lucide-react";

import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage,
  FormDescription
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { contactRequestSchema, type ContactRequest } from "@shared/schema";

export function ContactForm({ className }: { className?: string }) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ContactRequest>({
    resolver: zodResolver(contactRequestSchema),
    defaultValues: {
      name: "",
      email: "",
      subject: "contact",
      message: "",
    },
  });

  async function onSubmit(data: ContactRequest) {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) throw new Error("Failed to send message");

      setSubmitted(true);
      toast({
        title: "Message Sent",
        description: "We've received your message and will get back to you soon.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "There was a problem sending your message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="border-green-100 bg-green-50/10 dark:bg-green-950/20 dark:border-green-900 overflow-hidden">
        <CardContent className="pt-10 pb-12 text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="text-2xl font-bold text-foreground">Message Received!</h3>
          <p className="text-muted-foreground max-w-sm mx-auto">
            Thank you for reaching out. We've received your request and our team will review it shortly.
          </p>
          <Button variant="outline" className="mt-6" onClick={() => setSubmitted(false)}>
            Send Another Message
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("shadow-lg border-border/60", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          Get in Touch
        </CardTitle>
        <CardDescription>
          Request features, report bugs, or share recommendations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <User className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="John Doe" className="pl-9" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="john@example.com" className="pl-9" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Topic</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a topic" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="feature">
                        <div className="flex items-center gap-2 font-medium">
                          <Sparkles className="h-4 w-4 text-primary" />
                          <span>Request a New Feature</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="recommendation">
                        <div className="flex items-center gap-2 font-medium">
                          <Heart className="h-4 w-4 text-accent" />
                          <span>Recommendation</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="bug">
                        <div className="flex items-center gap-2 font-medium">
                          <Bug className="h-4 w-4 text-red-500" />
                          <span>Report a Bug</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="contact">
                        <div className="flex items-center gap-2 font-medium">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <span>General Contact</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="How can we help?" 
                      className="min-h-[100px] resize-none"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button 
              type="submit" 
              className="w-full bg-[#002147] hover:bg-[#003366] text-white h-10 transition-colors shadow-lg"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                "Sending..."
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Message
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
