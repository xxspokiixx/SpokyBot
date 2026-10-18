import { Bot, Check, Copy, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { useCopyFeedback, type CopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { grokImportPreview, teamImportPreview, type PendingTeamImport } from "@/lib/team-import";
import { api } from "@/state/store";
import { GROK_EXPORT_PROMPT, grokStarterPackage, type GrokTemplateCard } from "../../shared/grok-import";

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export interface GrokImportViewProps {
  url: string;
  card: GrokTemplateCard | null;
  loading: boolean;
  reply: string;
  error: string;
  copyState: CopyFeedback;
  onUrl: (url: string) => void;
  onLoad: () => void;
  onCopy: () => void;
  onReply: (reply: string) => void;
  onPreviewReply: () => void;
  onStarter: () => void;
}

/** Templates → Import → From Grok Bot: the share card, the export prompt, the reply box and the starter. */
export function GrokImportView(props: GrokImportViewProps) {
  const { url, card, loading, reply, error, copyState } = props;
  return (
    <section className="mt-5 rounded-2xl bg-raised/25 px-6 py-5" aria-labelledby="grok-import-title">
      <Bot size={25} className="text-ink-secondary" />
      <h3 id="grok-import-title" className="mt-3 text-[14px] font-medium text-ink">{t("grokImport.title")}</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{t("grokImport.hint")}</p>
      <div className="mt-4 flex gap-2">
        <input
          value={url}
          onChange={(event) => props.onUrl(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && props.onLoad()}
          placeholder={t("grokImport.linkPlaceholder")}
          aria-label={t("grokImport.linkLabel")}
          className="min-w-0 flex-1 rounded-xl bg-raised/80 px-3 py-2.5 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <button
          onClick={props.onLoad}
          disabled={!url.trim() || loading}
          className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-[13px] font-medium text-white hover:bg-accent/90 disabled:opacity-40"
        >
          {loading && <Loader2 size={13} className="animate-spin" />}
          {t("templates.load")}
        </button>
      </div>
      {card && (
        <article className="mt-4 rounded-xl border border-hairline px-4 py-3">
          <div className="text-[14px] font-medium text-ink">{card.name}</div>
          {card.creator && <div className="text-[12px] text-ink-secondary">{t("grokImport.by", { name: card.creator })}</div>}
          {card.description && <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">{card.description}</p>}
          <button
            onClick={props.onStarter}
            className="mt-3 flex items-center gap-1.5 rounded-full bg-raised px-3.5 py-2 text-[12.5px] text-ink hover:bg-raised-hover"
          >
            <Sparkles size={13} />
            {t("grokImport.starter")}
          </button>
          <p className="mt-1.5 text-[11.5px] text-ink-tertiary">{t("grokImport.starterHint")}</p>
        </article>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          onClick={props.onCopy}
          className="flex items-center gap-1.5 rounded-full bg-raised px-3.5 py-2 text-[12.5px] text-ink hover:bg-raised-hover"
        >
          {copyState === "copied" ? <Check size={13} className="text-success" /> : <Copy size={13} />}
          {copyState === "copied" ? t("grokImport.copied") : copyState === "failed" ? t("grokImport.copyFailed") : t("grokImport.copyPrompt")}
        </button>
        <span className="text-[12.5px] text-ink-secondary">{t("grokImport.promptHint")}</span>
      </div>
      <textarea
        value={reply}
        onChange={(event) => props.onReply(event.target.value)}
        placeholder={t("grokImport.replyPlaceholder")}
        aria-label={t("grokImport.replyLabel")}
        rows={4}
        className="mt-3 w-full resize-y rounded-xl bg-raised/80 px-3 py-2.5 font-mono text-[12px] text-ink placeholder:text-ink-secondary focus:outline-none"
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={props.onPreviewReply}
          disabled={!reply.trim()}
          className="rounded-full bg-accent px-4 py-2.5 text-[13px] font-medium text-white hover:bg-accent/90 disabled:opacity-40"
        >
          {t("grokImport.preview")}
        </button>
      </div>
      {error && <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</div>}
    </section>
  );
}

/** Loads the card for a pasted link (or `link`, from the GitHub box or an install link) and hands previews to the panel. */
export function GrokImportBox({ link, onPreview }: { link: string | null; onPreview: (preview: PendingTeamImport) => void }) {
  const [url, setUrl] = useState("");
  const [card, setCard] = useState<GrokTemplateCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const { state: copyState, copy } = useCopyFeedback(GROK_EXPORT_PROMPT);

  const load = async (value: string) => {
    if (!value.trim()) return;
    setLoading(true);
    setError("");
    try {
      // SAFETY: this endpoint is owned by the app and returns GrokTemplateCard.
      setCard((await api("/api/team-library/grok", { method: "POST", body: JSON.stringify({ url: value.trim() }) })) as GrokTemplateCard);
    } catch (cause) {
      setCard(null);
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!link) return;
    setUrl(link);
    void load(link);
  }, [link]);

  const preview = (build: () => PendingTeamImport) => {
    try {
      onPreview(build());
      setError("");
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  return (
    <GrokImportView
      url={url}
      card={card}
      loading={loading}
      reply={reply}
      error={error}
      copyState={copyState}
      onUrl={setUrl}
      onLoad={() => void load(url)}
      onCopy={copy}
      onReply={setReply}
      onPreviewReply={() => preview(() => grokImportPreview(reply, card ? { sourceUrl: card.url } : {}))}
      onStarter={() => card && preview(() => teamImportPreview(grokStarterPackage(card)))}
    />
  );
}
