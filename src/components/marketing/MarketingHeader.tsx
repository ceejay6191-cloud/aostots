import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-slate-900" />
              <div>
                <div className="text-sm font-semibold text-slate-900">AOSTOT</div>
                <div className="text-xs text-slate-500">Cloud On-Screen Takeoff</div>
              </div>
        </div>

        <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-700 sm:flex">
          <a href="#home" className="hover:text-slate-900">Home</a>
          <a href="#about" className="hover:text-slate-900">About</a>
          <a href="#pricing" className="hover:text-slate-900">Pricing</a>
          <a href="#contact" className="hover:text-slate-900">Contact Us</a>
        </nav>

        <div className="flex items-center gap-2">
          <Link to="/auth">
            <Button variant="outline" className="rounded-xl">Sign in</Button>
          </Link>
          <Link to="/auth">
            <Button className="rounded-xl">Get started</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
