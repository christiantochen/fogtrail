import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopyToast } from "./components/CopyToast";
import { ConnectionsMain } from "./components/ConnectionsMain";
import { ConnectionsSidebar } from "./components/ConnectionsSidebar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Main } from "./components/Main";
import { MenuBridge } from "./components/MenuBridge";
import { ThemeBridge } from "./components/ThemeBridge";
import { QuickOpen } from "./components/QuickOpen";
import { Resuming } from "./components/Resuming";
import { Sidebar } from "./components/Sidebar";
import { SqlMain } from "./components/SqlMain";
import { SqlSidebar } from "./components/SqlSidebar";
import { persistSession } from "./state/persist";
import { About } from "./components/About";
import { TitleBar } from "./components/TitleBar";
import { hasNativeFrame } from "./lib/windowApi";
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
  const sql = useUi((s) => s.connected?.store === "sql");
  const resuming = useUi((s) => s.resuming);
  // Wait to know who draws the window frame, so nothing jumps when the bar appears.
  const frameKnown = useUi((s) => s.customTitleBar !== null);
  useEffect(() => persistSession(), []);
  // Windows has no OS frame (see tauri.windows.conf.json), so we draw the title bar.
  useEffect(() => {
    void hasNativeFrame().then((native) =>
      useUi.getState().setCustomTitleBar(!native),
    );
  }, []);

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
        <ThemeBridge />
        <CopyToast />
        <QuickOpen />
        <About />
        <UpdateToast />
        {frameKnown && (
          <div className="shell">
            <TitleBar />
            <div className="app">
              {resuming ? (
                <Resuming />
              ) : browsing && sql ? (
                <>
                  <SqlSidebar />
                  <SqlMain />
                </>
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
          </div>
        )}
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
