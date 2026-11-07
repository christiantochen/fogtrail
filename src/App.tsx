import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopyToast } from "./components/CopyToast";
import { ConnectionsMain } from "./components/ConnectionsMain";
import { ConnectionsSidebar } from "./components/ConnectionsSidebar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Main } from "./components/Main";
import { MenuBridge } from "./components/MenuBridge";
import { QuickOpen } from "./components/QuickOpen";
import { Resuming } from "./components/Resuming";
import { Sidebar } from "./components/Sidebar";
import { persistSession } from "./state/persist";
import { About } from "./components/About";
import { UpdateToast } from "./components/UpdateToast";
import { useUi } from "./state/ui";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

export default function App() {
  // A live connection with the connections screen open on top is not "browsing".
  const browsing = useUi((s) => s.connected !== null && !s.picking);
  const resuming = useUi((s) => s.resuming);
  useEffect(() => persistSession(), []);

  // Cmd/Ctrl+K opens quick open from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        useUi.getState().setQuickOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MenuBridge />
        <CopyToast />
        <QuickOpen />
        <About />
        <UpdateToast />
        <div className="app">
          {resuming ? (
            <Resuming />
          ) : browsing ? (
            <>
              <Sidebar />
              <Main />
            </>
          ) : (
            <>
              <ConnectionsSidebar />
              <ConnectionsMain />
            </>
          )}
        </div>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
