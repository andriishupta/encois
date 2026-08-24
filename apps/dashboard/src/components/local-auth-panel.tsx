import type { User } from "firebase/auth";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signInWithLocalEmail } from "@/lib/local-auth";

type LocalAuthPanelProps = {
  onAuthenticated: (user: User) => Promise<void>;
};

export default function LocalAuthPanel({
  onAuthenticated,
}: LocalAuthPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setIsSubmitting(true);
    try {
      const user = await signInWithLocalEmail(email, password);
      await onAuthenticated(user);
    } catch {
      setError(
        "We could not complete local sign-in. Check the emulator credentials.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <p className="text-sm font-medium">Local Auth Emulator</p>
      <input
        aria-label="Local email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      />
      <input
        aria-label="Local password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      />
      <Button
        type="button"
        variant="outline"
        disabled={isSubmitting}
        onClick={() => void submit()}
      >
        Sign in locally
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
