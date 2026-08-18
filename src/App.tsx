"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

type Lang = "ar" | "en";
type InputMode = "chat" | "form" | "voice";
type Agreement = {
  project: string; provider: string; client: string; scope: string;
  deliverables: string; price: string; deposit: string; deadline: string;
  revisions: string; exclusions: string; responsibilities: string; notes: string;
};
type Receipt = { name: string; status: "approved" | "changes"; timestamp: string; hash: string; id: string };

const emptyAgreement: Agreement = {
  project: "", provider: "", client: "", scope: "", deliverables: "", price: "",
  deposit: "", deadline: "", revisions: "", exclusions: "", responsibilities: "", notes: "",
};

const labels: Record<keyof Agreement, [string, string]> = {
  project: ["اسم المشروع", "Project name"], provider: ["مقدّم الخدمة", "Service provider"],
  client: ["العميل", "Client"], scope: ["نطاق العمل", "Scope of work"],
  deliverables: ["المخرجات المطلوبة", "Deliverables"], price: ["القيمة الإجمالية", "Total price"],
  deposit: ["الدفعة المقدّمة", "Deposit"], deadline: ["موعد التسليم", "Deadline"],
  revisions: ["عدد التعديلات", "Revisions"], exclusions: ["غير مشمول", "Not included"],
  responsibilities: ["مسؤوليات الطرفين", "Responsibilities"], notes: ["ملاحظات إضافية", "Additional notes"],
};

const agreementKeys = Object.keys(labels) as (keyof Agreement)[];

function b64(bytes: Uint8Array) {
  let value = "";
  bytes.forEach((byte) => (value += String.fromCharCode(byte)));
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromB64(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function packAgreement(agreement: Agreement) {
  const raw = new TextEncoder().encode(JSON.stringify(agreementKeys.map((key) => agreement[key])));
  if (!("CompressionStream" in window)) return { mode: "r", bytes: raw };
  try {
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"));
    const zipped = new Uint8Array(await new Response(stream).arrayBuffer());
    return zipped.length < raw.length ? { mode: "z", bytes: zipped } : { mode: "r", bytes: raw };
  } catch { return { mode: "r", bytes: raw }; }
}

async function unpackAgreement(mode: string, bytes: Uint8Array): Promise<Agreement> {
  let plain = bytes;
  if (mode === "z") {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    plain = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const values = JSON.parse(new TextDecoder().decode(plain)) as string[];
  return agreementKeys.reduce((result, key, index) => ({ ...result, [key]: values[index] ?? "" }), { ...emptyAgreement });
}

function inferAgreement(text: string): Agreement {
  const clean = text.trim();
  const lines = clean.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const price = clean.match(/(?:\$|USD|AED|SAR|دولار|درهم|ريال)\s?[\d,.]+|[\d,.]+\s?(?:\$|USD|AED|SAR|دولار|درهم|ريال)/i)?.[0] ?? "";
  const deadline = clean.match(/(?:التسليم|الموعد|due|deadline)\s*[:\-]?\s*([^\n,.]{3,38})/i)?.[1]?.trim() ?? "";
  const revisions = clean.match(/(?:تعديل(?:ات)?|revisions?)\s*[:\-]?\s*(\d+|واحد|اثنين|ثلاثة|one|two|three)/i)?.[1] ?? "";
  const deposit = clean.match(/(?:عربون|دفعة مقدمة|deposit)\s*[:\-]?\s*([^\n,.]{2,24})/i)?.[1]?.trim() ?? "";
  return {
    ...emptyAgreement,
    project: lines[0]?.slice(0, 90) ?? "",
    scope: clean.slice(0, 520),
    deliverables: lines.slice(1, 5).join(" • "),
    price, deadline, revisions, deposit,
  };
}

function Logo() {
  return <span className="logo"><span className="logo-mark"><i>✓</i></span><span className="logo-type">TAMM<small>تمّ</small></span></span>;
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("ar");
  const [mode, setMode] = useState<InputMode>("chat");
  const [stage, setStage] = useState<"compose" | "review" | "shared">("compose");
  const [chat, setChat] = useState("");
  const [agreement, setAgreement] = useState<Agreement>(emptyAgreement);
  const [sharedLink, setSharedLink] = useState("");
  const [notice, setNotice] = useState("");
  const [approver, setApprover] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const ar = lang === "ar";

  useEffect(() => {
    const readShared = async () => {
      const token = location.hash.startsWith("#t=") ? location.hash.slice(3) : location.hash.startsWith("#tamm=") ? location.hash.slice(6) : "";
      if (!token) return;
      try {
        const parts = token.split(".");
        const modern = parts.length === 4;
        const [mode, keyPart, ivPart, cipherPart] = modern ? parts : ["legacy", ...parts];
        const key = await crypto.subtle.importKey("raw", fromB64(keyPart), "AES-GCM", false, ["decrypt"]);
        const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(ivPart) }, key, fromB64(cipherPart));
        const parsed = modern ? await unpackAgreement(mode, new Uint8Array(plain)) : JSON.parse(new TextDecoder().decode(plain)) as Agreement;
        setAgreement({ ...emptyAgreement, ...parsed });
        setStage("shared");
      } catch { setNotice(ar ? "الرابط غير صالح أو ناقص." : "This link is invalid or incomplete."); }
    };
    void readShared();
  }, [ar]);

  useEffect(() => {
    const recordVisit = async () => {
      try {
        let sessionId = sessionStorage.getItem("tamm_visit_session");
        if (!sessionId) {
          sessionId = b64(crypto.getRandomValues(new Uint8Array(18)));
          sessionStorage.setItem("tamm_visit_session", sessionId);
        }
        await fetch("/api/visit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId }), keepalive: true });
      } catch { /* Visitor counting must never interrupt the private agreement flow. */ }
    };
    void recordVisit();
  }, []);

  const update = (key: keyof Agreement, value: string) => setAgreement((current) => ({ ...current, [key]: value }));

  const structure = () => {
    if (mode === "chat") {
      if (!chat.trim()) { setNotice(ar ? "الصق المحادثة أولاً." : "Paste the conversation first."); return; }
      setAgreement(inferAgreement(chat));
    }
    setNotice("");
    setStage("review");
    setTimeout(() => document.querySelector("#review")?.scrollIntoView({ behavior: "smooth" }), 30);
  };

  const makeLink = async () => {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);
    const packed = await packAgreement(agreement);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, packed.bytes);
    const link = `${location.origin}${location.pathname}#t=${packed.mode}.${b64(rawKey)}.${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
    setSharedLink(link);
    await navigator.clipboard?.writeText(link);
    setNotice(ar ? "تم نسخ الرابط المشفّر." : "Encrypted link copied.");
  };

  const exportTamm = () => {
    const blob = new Blob([JSON.stringify({ version: 1, agreement }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `TAMM-${Date.now()}.tamm`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = async () => {
    const target = document.querySelector<HTMLElement>("[data-tamm-pdf]");
    if (!target) return;
    setNotice(ar ? "يتم تجهيز ملف PDF…" : "Preparing PDF…");
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const canvas = await html2canvas(target, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const maxWidth = 190, maxHeight = 277;
      const ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      const width = canvas.width * ratio, height = canvas.height * ratio;
      pdf.addImage(canvas.toDataURL("image/jpeg", .94), "JPEG", (210 - width) / 2, 10, width, height, undefined, "FAST");
      const name = (agreement.project || "agreement").replace(/[^\p{L}\p{N}-]+/gu, "-").slice(0, 60);
      pdf.save(`TAMM-${name}.pdf`);
      setNotice(ar ? "تم تنزيل ملف PDF." : "PDF downloaded.");
    } catch { setNotice(ar ? "تعذّر إنشاء PDF على هذا المتصفح." : "PDF could not be created in this browser."); }
  };

  const importTamm = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || file.size > 250_000) return;
    try {
      const parsed = JSON.parse(await file.text());
      setAgreement({ ...emptyAgreement, ...(parsed.agreement ?? parsed) }); setStage("review");
    } catch { setNotice(ar ? "ملف TAMM غير صالح." : "Invalid TAMM file."); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => chunks.current.push(event.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: recorder.mimeType });
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start(); setRecording(true);
    } catch { setNotice(ar ? "تعذّر تشغيل الميكروفون." : "Microphone access failed."); }
  };

  const stopRecording = () => { mediaRecorder.current?.stop(); setRecording(false); };

  const approve = async (status: "approved" | "changes") => {
    if (!approver.trim()) { setNotice(ar ? "اكتب اسمك أولاً." : "Enter your name first."); return; }
    const timestamp = new Date().toISOString();
    const hash = await digest(JSON.stringify(agreement));
    setReceipt({ name: approver.trim(), status, timestamp, hash, id: `TM-${hash.slice(0, 10).toUpperCase()}` });
    setNotice("");
  };

  const downloadReceipt = () => {
    if (!receipt) return;
    const blob = new Blob([JSON.stringify({ agreement, receipt, notice: "Technical understanding receipt; not legal advice or a trusted timestamp." }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${receipt.id}.json`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
  };

  const clearAll = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setChat(""); setAgreement(emptyAgreement); setSharedLink(""); setReceipt(null); setApprover(""); setAudioUrl(""); setStage("compose");
    history.replaceState(null, "", location.pathname); window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const fields = Object.keys(labels) as (keyof Agreement)[];

  return (
    <main className="site" dir={ar ? "rtl" : "ltr"}>
      <header className="nav-shell">
        <nav className="nav">
          <a href="#top" aria-label="TAMM"><Logo /></a>
          <div className="nav-links">
            <a href="#how">{ar ? "كيف يعمل" : "How it works"}</a>
            <a href="#about">{ar ? "من نحن" : "About"}</a>
            <button className="language" onClick={() => setLang(ar ? "en" : "ar")}>{ar ? "EN" : "العربية"}</button>
          </div>
        </nav>
      </header>

      {stage !== "shared" && <>
        <section className="hero" id="top">
          <div className="hero-copy">
            <div className="kicker"><span />{ar ? "وضوح يحمي الطرفين" : "Clarity protects both sides"}</div>
            <h1>{ar ? <>كل ما اتفقتما عليه،<br /><em>في مكانٍ واحد.</em></> : <>Everything you agreed on,<br /><em>in one place.</em></>}</h1>
            <p>{ar ? "حوّل المحادثات والملاحظات المتناثرة إلى اتفاق واضح، محترف، وقابل للمراجعة—من دون حساب أو رفع بياناتك." : "Turn scattered chats and notes into one clear, professional, reviewable agreement—without an account or uploading your data."}</p>
            <a className="hero-cta" href="#builder">{ar ? "أنشئ اتفاقك الآن" : "Create your agreement"}<span>↙</span></a>
          </div>
          <div className="hero-seal" aria-hidden="true"><div><b>T</b><span>{ar ? "خاص محلياً" : "PRIVATE BY DESIGN"}</span></div></div>
        </section>

        <section className="builder" id="builder">
          <div className="builder-top">
            <div><span className="section-no">01</span><h2>{ar ? "ابدأ من حيث أنت" : "Start where you are"}</h2></div>
            <p>{ar ? "اختر الطريقة الأسهل لك. لا شيء يغادر هذا المتصفح." : "Choose what feels easiest. Nothing leaves this browser."}</p>
          </div>
          <div className="mode-tabs" role="tablist">
            <button className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>{ar ? "لصق محادثة" : "Paste conversation"}</button>
            <button className={mode === "form" ? "active" : ""} onClick={() => setMode("form")}>{ar ? "تعبئة يدوية" : "Fill manually"}</button>
            <button className={mode === "voice" ? "active" : ""} onClick={() => setMode("voice")}>{ar ? "ملاحظة صوتية" : "Voice note"}</button>
          </div>

          {mode === "chat" && <div className="chat-panel">
            <label htmlFor="chat">{ar ? "المحادثة أو الملاحظات" : "Conversation or notes"}</label>
            <textarea id="chat" value={chat} onChange={(event) => setChat(event.target.value)} maxLength={12000} placeholder={ar ? "الصق هنا ما تم الاتفاق عليه…\nمثال: تصميم هوية كاملة بقيمة 800$، التسليم في 20 سبتمبر، ويشمل تعديلين." : "Paste what was agreed here…\nExample: A full brand identity for $800, due September 20, including two revisions."} />
            <div className="privacy-line"><span className="lock">⌁</span>{ar ? "يُعالَج النص على جهازك فقط ويختفي عند إغلاق الصفحة." : "Processed only on your device and gone when the page closes."}<b>{chat.length}/12000</b></div>
          </div>}

          {mode === "form" && <div className="form-grid compact">
            {fields.map((key) => <label key={key}><span>{ar ? labels[key][0] : labels[key][1]}</span>{["scope", "deliverables", "exclusions", "responsibilities", "notes"].includes(key) ? <textarea value={agreement[key]} onChange={(e) => update(key, e.target.value)} /> : <input value={agreement[key]} onChange={(e) => update(key, e.target.value)} />}</label>)}
          </div>}

          {mode === "voice" && <div className="voice-panel">
            <button className={`record ${recording ? "recording" : ""}`} onPointerDown={() => !recording && void startRecording()} onPointerUp={() => recording && stopRecording()} onPointerLeave={() => recording && stopRecording()} aria-label={ar ? "اضغط مطولاً للتسجيل" : "Hold to record"}><i />{recording ? (ar ? "ارفع إصبعك للإيقاف" : "Release to stop") : (ar ? "اضغط مطولاً وسجّل ملاحظتك" : "Hold to record your note")}</button>
            {audioUrl && <div className="audio-row"><audio controls src={audioUrl} /><button onClick={() => { URL.revokeObjectURL(audioUrl); setAudioUrl(""); }}>{ar ? "حذف" : "Delete"}</button></div>}
            <p>{ar ? "التسجيل محلي بالكامل. استمع إليه ثم انتقل للتعبئة اليدوية—لا يتم تحويله إلى نص أو إرساله لأي جهة." : "Entirely local. Review it, then fill the form manually—no transcription or upload."}</p>
          </div>}

          <div className="builder-actions">
            <button className="text-button" onClick={() => fileInput.current?.click()}>{ar ? "استيراد ملف TAMM" : "Import TAMM file"}</button>
            <input ref={fileInput} hidden type="file" accept=".tamm,application/json" onChange={importTamm} />
            <button className="primary" onClick={structure}>{ar ? "مراجعة الاتفاق" : "Review agreement"}<span>←</span></button>
          </div>
          {notice && <p className="notice" role="status">{notice}</p>}
        </section>
      </>}

      {(stage === "review" || stage === "shared") && <section className={`review ${stage === "shared" ? "shared-view" : ""}`} id="review">
        <div className="review-head"><div><span className="section-no">{stage === "shared" ? "TAMM" : "02"}</span><h2>{stage === "shared" ? (ar ? "راجع الاتفاق" : "Review the agreement") : (ar ? "راجع قبل المشاركة" : "Review before sharing")}</h2></div><span className="draft-badge">{stage === "shared" ? (ar ? "نسخة مستلمة" : "RECEIVED COPY") : (ar ? "مسودة محلية" : "LOCAL DRAFT")}</span></div>
        <div className="agreement-paper" data-tamm-pdf>
          <div className="paper-brand"><Logo /><span>{ar ? "وثيقة تفاهم" : "UNDERSTANDING RECORD"}</span></div>
          <div className="agreement-grid">
            {fields.map((key) => <div className={["scope", "deliverables", "exclusions", "responsibilities", "notes"].includes(key) ? "wide" : ""} key={key}><label>{ar ? labels[key][0] : labels[key][1]}</label>{stage === "review" ? (["scope", "deliverables", "exclusions", "responsibilities", "notes"].includes(key) ? <textarea value={agreement[key]} onChange={(event) => update(key, event.target.value)} placeholder="—" /> : <input value={agreement[key]} onChange={(event) => update(key, event.target.value)} placeholder="—" />) : <p>{agreement[key] || "—"}</p>}</div>)}
          </div>
          <p className="legal-note">{ar ? "هذه أداة لترتيب التفاهم وإثبات نسخته تقنياً، وليست عقداً قانونياً أو توقيعاً إلكترونياً موثوقاً." : "This tool structures an understanding and records its technical copy. It is not legal advice, a legal contract, or a trusted electronic signature."}</p>
        </div>

        {stage === "review" && <div className="share-panel">
          <div><h3>{ar ? "جاهز للمشاركة؟" : "Ready to share?"}</h3><p>{ar ? "المحتوى والمفتاح داخل جزء مشفّر من الرابط لا يُرسل إلى خادم TAMM." : "The content and key live in an encrypted URL fragment that TAMM's server never receives."}</p></div>
          <div className="share-actions"><button className="secondary" onClick={() => void downloadPdf()}>{ar ? "تنزيل PDF" : "Download PDF"}</button><button className="secondary" onClick={exportTamm}>{ar ? "حفظ ملف .tamm" : "Save .tamm file"}</button><button className="primary" onClick={() => void makeLink()}>{ar ? "نسخ الرابط المشفّر" : "Copy encrypted link"}</button></div>
          {sharedLink && <div className="link-box"><code>{sharedLink.slice(0, 78)}…</code><a target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(sharedLink)}`}>{ar ? "إرسال عبر واتساب" : "Share on WhatsApp"}</a></div>}
        </div>}

        {stage === "shared" && !receipt && <div className="approval-panel">
          <h3>{ar ? "هل يعكس هذا ما اتفقتما عليه؟" : "Does this reflect what you agreed?"}</h3>
          <input value={approver} onChange={(event) => setApprover(event.target.value)} placeholder={ar ? "اسمك كما تريد ظهوره في الإيصال" : "Your name as it should appear on the receipt"} />
          <div><button className="secondary" onClick={() => void approve("changes")}>{ar ? "أطلب تعديلاً" : "Request changes"}</button><button className="primary" onClick={() => void approve("approved")}>{ar ? "واضح — أعتمد النسخة" : "Clear — approve this copy"}</button></div>
          {notice && <p className="notice">{notice}</p>}
        </div>}

        {receipt && <div className="receipt">
          <div className="receipt-check">✓</div><div><span>{receipt.id}</span><h3>{receipt.status === "approved" ? (ar ? "تم اعتماد النسخة" : "Copy approved") : (ar ? "تم طلب تعديل" : "Changes requested")}</h3><p>{receipt.name} · {new Date(receipt.timestamp).toLocaleString(ar ? "ar" : "en")}</p><code>SHA-256 {receipt.hash.slice(0, 28)}…</code></div>
          <div className="receipt-actions"><button onClick={downloadReceipt}>{ar ? "تنزيل إيصال التحقق" : "Download verification receipt"}</button><button onClick={() => void downloadPdf()}>{ar ? "تنزيل PDF" : "Download PDF"}</button></div>
        </div>}
      </section>}

      <section className="how" id="how">
        <div className="section-title"><span className="section-no">03</span><h2>{ar ? "من الكلام إلى الوضوح" : "From conversation to clarity"}</h2></div>
        <div className="how-grid">
          <article><b>01</b><h3>{ar ? "أدخل التفاصيل" : "Bring the details"}</h3><p>{ar ? "الصق محادثة أو اكتب الاتفاق بنفسك." : "Paste a chat or enter the agreement yourself."}</p></article>
          <article><b>02</b><h3>{ar ? "راجع بهدوء" : "Review calmly"}</h3><p>{ar ? "صحّح أي تفصيل ناقص قبل المشاركة." : "Fix anything missing before sharing."}</p></article>
          <article><b>03</b><h3>{ar ? "شارك بثقة" : "Share with confidence"}</h3><p>{ar ? "أرسل رابطاً مشفّراً واستلم إيصال النسخة." : "Send an encrypted link and receive a copy receipt."}</p></article>
        </div>
      </section>

      <section className="about" id="about">
        <div className="about-mark"><Logo /></div>
        <div><span className="section-no">{ar ? "من نحن" : "ABOUT"}</span><h2>{ar ? "نؤمن أن الوضوح شكلٌ من أشكال الاحترام." : "We believe clarity is a form of respect."}</h2></div>
        <div className="about-copy"><p>{ar ? "صُمّم TAMM للمستقلين والعملاء والفرق الصغيرة الذين يريدون تثبيت ما اتفقوا عليه من دون تعقيد المنصات أو جمع البيانات." : "TAMM is designed for freelancers, clients, and small teams who want to capture what was agreed without platform complexity or data collection."}</p><p>{ar ? "لا حسابات. لا تتبع. لا ذاكرة مخفية. أنت تملك نسختك من البداية إلى النهاية." : "No accounts. No tracking. No hidden memory. You own your copy from beginning to end."}</p></div>
      </section>

      <footer><Logo /><p>{ar ? "اتفاقات أوضح. علاقات عمل أفضل." : "Clearer agreements. Better working relationships."}</p><div><button onClick={clearAll}>{ar ? "مسح الجلسة" : "Clear session"}</button><span>© 2026 TAMM</span></div></footer>
    </main>
  );
}
