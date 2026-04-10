import { useState, useRef, useCallback } from "react";

type Status = "idle" | "downloading" | "complete" | "error";

const FORMAT_OPTIONS = ["mp3", "wav", "flac", "aac", "opus", "m4a"] as const;

function App() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<string>("mp3");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setProgress(0);
    setTitle(null);
    setError(null);
    setJobId(null);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const startDownload = async () => {
    if (!url.trim()) return;

    reset();
    setStatus("downloading");

    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), format }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start download");
      }

      const { jobId: id } = await res.json();
      setJobId(id);

      // Listen for progress via SSE
      const es = new EventSource(`/api/progress/${id}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setProgress(data.progress);
        if (data.title) setTitle(data.title);

        if (data.status === "complete") {
          setStatus("complete");
          es.close();
        } else if (data.status === "error") {
          setStatus("error");
          setError("Conversion failed. Check the URL and try again.");
          es.close();
        }
      };

      es.onerror = () => {
        es.close();
        if (status !== "complete") {
          setStatus("error");
          setError("Lost connection to server.");
        }
      };
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && status !== "downloading") {
      startDownload();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="text-red-500">YT</span> Converter
          </h1>
          <p className="text-gray-400">
            Paste a YouTube URL, pick a format, and download.
          </p>
        </div>

        {/* Input area */}
        <div className="space-y-4">
          <input
            type="text"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status === "downloading"}
            className="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent disabled:opacity-50 transition"
          />

          <div className="flex gap-3 items-center">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              disabled={status === "downloading"}
              className="px-3 py-3 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 transition"
            >
              {FORMAT_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  .{f}
                </option>
              ))}
            </select>

            <button
              onClick={status === "idle" || status === "error" || status === "complete" ? startDownload : undefined}
              disabled={status === "downloading" || !url.trim()}
              className="flex-1 py-3 rounded-lg bg-red-600 hover:bg-red-700 active:bg-red-800 font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {status === "downloading" ? "Converting..." : "Convert"}
            </button>
          </div>
        </div>

        {/* Progress */}
        {status === "downloading" && (
          <div className="space-y-2">
            {title && (
              <p className="text-sm text-gray-400 truncate" title={title}>
                {title}
              </p>
            )}
            <div className="w-full bg-gray-800 rounded-full h-4 overflow-hidden">
              <div
                className="h-full bg-red-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-gray-400 text-right">
              {progress.toFixed(1)}%
            </p>
          </div>
        )}

        {/* Complete */}
        {status === "complete" && jobId && (
          <div className="space-y-3 text-center">
            {title && (
              <p className="text-sm text-gray-400 truncate" title={title}>
                {title}
              </p>
            )}
            <div className="flex gap-3">
              <a
                href={`/api/file/${jobId}`}
                className="flex-1 inline-block py-3 rounded-lg bg-green-600 hover:bg-green-700 font-semibold text-center transition"
              >
                Download .{format}
              </a>
              <button
                onClick={() => {
                  reset();
                  setUrl("");
                }}
                className="px-6 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 font-semibold transition cursor-pointer"
              >
                New
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && error && (
          <div className="p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
