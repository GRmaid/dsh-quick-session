window.__ModuleLoader__.load({
	id: "dsh-quick-session",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");

		/**
		* The official whale mark's path data, required rather than copied so the tail
		* keeps the shipped geometry. The official brand package reads it the same way.
		*/
		let fishLogoPath = "";
		try {
			fishLogoPath = require("@deepseek-ai/dsh-client-ui-primitives").FISH_LOGO_PATH ?? "";
		} catch (error) {
			console.warn("[dsh-quick-session] 官方品牌路径不可用，图标回退为占位字形", error);
		}

		/** This plugin's registration ids and the seats it fills. */
		const PLUGIN_ID = "dsh-quick-session";
		const ACTION_LABEL = "快捷会话";
		const ACTION_HINT = "新建一个不使用工作区的会话：它拥有自己的临时目录，不加入任何项目";
		/**
		* The host route that prepares one scratch directory. This profile composes
		* the native directory picker, whose capability serves only `pick`, so the
		* browse verbs the browser half would need are refused here.
		*/
		const PREPARE_PATH = "/plugins/dsh-quick-session/prepare";

		//#region dialog state (shared by the sidebar action and the overlay)
		/** Whether the first-message dialog is open. */
		let dialogOpen = false;
		const dialogListeners = /* @__PURE__ */ new Set();
		/** Open or close the first-message dialog. */
		function setDialogOpen(next) {
			if (dialogOpen === next) return;
			dialogOpen = next;
			for (const listener of dialogListeners) listener();
		}
		/** Subscribe to dialog state, for `useSyncExternalStore`. */
		function subscribeDialog(listener) {
			dialogListeners.add(listener);
			return () => dialogListeners.delete(listener);
		}
		/** Current dialog state, for `useSyncExternalStore`. */
		function readDialogOpen() {
			return dialogOpen;
		}
		//#endregion

		/** Append this entry's styles once, into the page that renders it. */
		function ensureStyle() {
			const existing = document.getElementById("dsh-quick-session-style");
			const style = existing !== null ? existing : document.createElement("style");
			if (existing === null) {
				style.id = "dsh-quick-session-style";
				document.head.appendChild(style);
			}
			style.textContent = [
				".dsh-qs-action{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:15px;line-height:1;cursor:pointer}",
				".dsh-qs-action:hover:not(:disabled){background:rgba(127,127,127,.18)}",
				".dsh-qs-action:disabled{opacity:.5;cursor:default}",
				".dsh-qs-label{font-size:12px;opacity:.75;white-space:nowrap}",
				".dsh-qs-backdrop{pointer-events:auto;position:fixed;inset:0;z-index:4000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.32)}",
				".dsh-qs-dialog{pointer-events:auto;box-sizing:border-box;width:min(560px,calc(100vw - 48px));display:flex;flex-direction:column;gap:10px;padding:16px 18px 14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 12px 40px rgba(0,0,0,.28)}",
				".dsh-qs-title{font-size:15px;font-weight:600}",
				".dsh-qs-sub{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}",
				".dsh-qs-input{box-sizing:border-box;width:100%;min-height:96px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.6;resize:vertical}",
				".dsh-qs-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}",
				".dsh-qs-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}",
				".dsh-qs-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary);word-break:break-all}",
				".dsh-qs-actions{display:flex;justify-content:flex-end;gap:8px}",
				".dsh-qs-btn{padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}",
				".dsh-qs-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}",
				".dsh-qs-btn:disabled{opacity:.5;cursor:default}",
				".dsh-qs-btn-primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}"
			].join("");
		}

		/** One random UUID, preferring the platform generator (absent on non-secure origins). */
		function randomId() {
			if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
			const bytes = new Uint8Array(16);
			if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
			else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
			bytes[6] = bytes[6] & 15 | 64;
			bytes[8] = bytes[8] & 63 | 128;
			const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
			return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
		}

		/** Unwrap one generated Remote result, raising its failure as an Error. */
		function unwrap(result) {
			if (result === null || typeof result !== "object" || !("ok" in result)) return result;
			if (result.ok) return result.value;
			const failure = result.error;
			throw failure instanceof Error ? failure : new Error(String(failure));
		}

		/** The browser's time zone, when it can be resolved. */
		function clientTimeZone() {
			try {
				return Intl.DateTimeFormat().resolvedOptions().timeZone;
			} catch {
				return void 0;
			}
		}

		/**
		* Ask the Host to mint this Session's own scratch directory.
		* @returns the absolute directory the new Session will own.
		*/
		async function prepareScratchDirectory() {
			let response;
			try {
				response = await fetch(PREPARE_PATH, { method: "POST" });
			} catch (error) {
				throw new Error(`连不上宿主，无法准备临时目录：${error instanceof Error ? error.message : String(error)}`);
			}
			if (response.status === 401 || response.status === 403) throw new Error("宿主拒绝了请求，请刷新页面后重试");
			const payload = await response.json().catch(() => void 0);
			if (!response.ok || payload === void 0 || typeof payload.cwd !== "string" || payload.cwd === "") {
				const detail = payload !== void 0 && typeof payload.message === "string" ? `：${payload.message}` : `（HTTP ${response.status}）`;
				throw new Error(`宿主未能准备临时目录${detail}`);
			}
			return payload.cwd;
		}

		/**
		* Start one Session that owns no Workspace and hand it its opening message.
		*
		* The Session's cwd is a fresh directory the Host minted under its own
		* `scratch` tree, which becomes the file sandbox's workspace-write boundary
		* and the working directory of every shell command it runs. Nothing is
		* registered as a Workspace, so the sidebar files the row under Ungrouped.
		*
		* The opening message is not a convenience: the shipped Conversation keeps a
		* Workspace-less Session's composer inert while that Session is still blank,
		* so the first message has to arrive before the native composer can take over.
		* @param ctx - this plugin's client Context.
		* @param text - the opening message, which must be non-blank.
		* @returns the created Session identity and its scratch directory.
		*/
		async function startQuickSession(ctx, text) {
			const uiWorkspace = ctx.uiWorkspace;
			const remote = ctx.remote;
			const message = typeof text === "string" ? text.trim() : "";
			if (message === "") throw new Error("请先写下要处理的内容");
			const cwd = await prepareScratchDirectory();
			const sessionId = `session-${randomId()}`;
			unwrap(await remote.session.create({ sessionId, cwd }));
			try {
				unwrap(await remote.session.prompt({
					requestId: randomId(),
					sessionId,
					mode: "queue",
					content: [{ type: "text", text: message }],
					clientTimeZone: clientTimeZone()
				}));
			} catch (error) {
				uiWorkspace.openSession(sessionId);
				throw error;
			}
			uiWorkspace.openSession(sessionId);
			return { sessionId, cwd };
		}

		/**
		* This session's own whale-tail artwork, inlined as an alpha mask.
		*
		* The source is an opaque dark plane carrying light line art, so the icon keys
		* that plane out and then paints what survives with `currentColor`: the glyph
		* follows the theme instead of dragging a dark tile into a light sidebar. The
		* key thresholds come from the artwork's own luma histogram (plane mode 24).
		* 94×96 px, ~4 KB — small enough to ride inside this bundle.
		*/
		const TAIL_MASK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAF4AAABgCAMAAACjfDWBAAACzVBMVEVMaXH////////////////////////////////+/v7////////////////////////////////////////////////////+/v7////////+/v7////////////+/v7////////////////+/v7////////////////////////+/v7+/v7////////////////////////////+/v7+/v7////////////////////////////////////////////////////////////////+/v7////+/v7////////////////////////+/v7////////////////////////////////////////+/v7////////////////+/v7////////////////////////////////////////////////////////////////+/v7////////////////////////////+/v7////+/v7////////////////////////////////////////////////////////////////////////////////////////////+/v7////////////////////////////////////////////////////+/v7+/v7////////////////////////////////////////////////////////////////+/v7////////////+/v7////////////////////////////////////////////////+/v7////////////////////////////////+/v7////////////////+/v7+/v7////////+/v7+/v7////////////////////+/v7////////////////////////////////////+/v7///////////////////////////////////8A3O6sAAAA7nRSTlMA+wQFAf0C/gP88/rxC87wMhE2Gtf5+OnoItEKDbkHCEjkOeXaj/Qq1Qn2ymDcmRefBt3uUsdFHg9yJ40MHxYgfF3BEqG/wymsIRUsQjDP2duzKxgUEEtAy2WT9Z1Do9PSpepEvYDsTkGLdF5ZiE/t4SbMl3pq9zia4phfSSU942jQ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";

		/**
		* The icon's fallback ladder: this package's own artwork, else the official
		* mark's fluke, else a placeholder glyph — the button never renders empty.
		* @param props.size - square edge in px; defaults to 20.
		* @returns the tail as a themed mask, an svg, or a placeholder glyph.
		*/
		const TAIL_VIEWBOX = "16.2 0 6.96 8.4";
		function WhaleTailIcon(props) {
			const size = props.size === undefined ? 20 : props.size;
			if (TAIL_MASK !== "") {
				const url = `url("${TAIL_MASK}")`;
				return react.createElement("span", {
					"aria-hidden": "true",
					style: {
						display: "block",
						width: `${size}px`,
						height: `${size}px`,
						backgroundColor: "currentColor",
						WebkitMaskImage: url,
						WebkitMaskSize: "contain",
						WebkitMaskRepeat: "no-repeat",
						WebkitMaskPosition: "center",
						maskImage: url,
						maskSize: "contain",
						maskRepeat: "no-repeat",
						maskPosition: "center"
					}
				});
			}
			if (fishLogoPath === "") return react.createElement("span", {
				"aria-hidden": "true",
				style: { fontSize: `${Math.round(size * 0.8)}px`, lineHeight: 1 }
			}, "⚡");
			return react.createElement("svg", {
				width: size,
				height: size,
				viewBox: TAIL_VIEWBOX,
				fill: "none",
				"aria-hidden": "true",
				style: { display: "block" }
			}, react.createElement("path", { d: fishLogoPath, fill: "currentColor" }));
		}

		/**
		* The sidebar-foot action that opens the first-message dialog.
		* @param props - owner share (`wide`) plus this plugin's Context.
		* @returns the action row.
		*/
		function QuickSessionAction(props) {
			ensureStyle();
			const open = react.useSyncExternalStore(subscribeDialog, readDialogOpen, readDialogOpen);
			return react.createElement("span", { className: "dsh-qs-wrap", style: { display: "inline-flex", alignItems: "center", gap: "6px" } },
				react.createElement("button", {
					type: "button",
					className: "dsh-qs-action",
					title: ACTION_HINT,
					"aria-label": ACTION_LABEL,
					"aria-pressed": open,
					onClick: () => setDialogOpen(true)
				}, react.createElement(WhaleTailIcon, { size: 20 })),
				props.wide === true ? react.createElement("span", { className: "dsh-qs-label" }, ACTION_LABEL) : null
			);
		}

		/**
		* The first-message dialog itself: one textarea, Enter to start.
		* @param props - this plugin's Context.
		* @returns the dialog, or null while closed.
		*/
		function QuickSessionDialog(props) {
			ensureStyle();
			const open = react.useSyncExternalStore(subscribeDialog, readDialogOpen, readDialogOpen);
			const [text, setText] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [failure, setFailure] = react.useState("");
			const ctx = props.ctx;
			react.useEffect(() => {
				if (open) {
					setText("");
					setFailure("");
					setBusy(false);
				}
			}, [open]);
			const close = react.useCallback(() => {
				setDialogOpen(false);
			}, []);
			const submit = react.useCallback(() => {
				const message = text.trim();
				if (busy || message === "") return;
				setBusy(true);
				setFailure("");
				Promise.resolve().then(() => startQuickSession(ctx, message)).then(() => {
					setDialogOpen(false);
				}).catch((error) => {
					const detail = error instanceof Error ? error.message : String(error);
					console.error("[dsh-quick-session] 新建快捷会话失败", error);
					setFailure(detail);
				}).finally(() => {
					setBusy(false);
				});
			}, [busy, ctx, text]);
			const onKeyDown = react.useCallback((event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					close();
					return;
				}
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					submit();
				}
			}, [close, submit]);
			if (!open) return null;
			return react.createElement("div", {
				className: "dsh-qs-backdrop",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) close();
				}
			}, react.createElement("div", { className: "dsh-qs-dialog", role: "dialog", "aria-label": ACTION_LABEL },
				react.createElement("div", { className: "dsh-qs-title" }, ACTION_LABEL),
				react.createElement("div", { className: "dsh-qs-sub" }, "不使用工作区：这次会话有自己的临时目录，不会加入任何项目；它写入的文件只落在那个目录里，关闭后也不会自动清理。"),
				react.createElement("textarea", {
					className: "dsh-qs-input",
					autoFocus: true,
					value: text,
					placeholder: "写下要处理的小任务。Enter 开始，Shift+Enter 换行。",
					disabled: busy,
					onChange: (event) => setText(event.target.value),
					onKeyDown
				}),
				react.createElement("div", { className: "dsh-qs-hint" }, "临时目录：~/.dsh/scratch/<本次会话>　·　权限沿用当前四档（默认「工作区写入 + 变更前确认」），沙箱边界就是该目录。"),
				failure === "" ? null : react.createElement("div", { className: "dsh-qs-error" }, `创建失败：${failure}`),
				react.createElement("div", { className: "dsh-qs-actions" },
					react.createElement("button", { type: "button", className: "dsh-qs-btn", disabled: busy, onClick: close }, "取消"),
					react.createElement("button", {
						type: "button",
						className: "dsh-qs-btn dsh-qs-btn-primary",
						disabled: busy || text.trim() === "",
						onClick: submit
					}, busy ? "正在创建…" : "开始")
				)
			));
		}

		/**
		* Wire this plugin's browser-surface contributions.
		* @param ctx - this plugin's client Context.
		*/
		function apply(ctx) {
			const register = () => {
				ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
					name: "sidebar.footer.action",
					id: PLUGIN_ID,
					order: 45,
					label: ACTION_LABEL
				}, (props) => react.createElement(QuickSessionAction, { ctx, wide: props && props.wide === true })));
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: `${PLUGIN_ID}-dialog`,
					order: 850
				}, () => react.createElement(QuickSessionDialog, { ctx })));
			};
			if (typeof ctx.effect === "function") ctx.effect(register, "dsh-quick-session: sidebar action and dialog");
			else register();
		}

		exports.apply = apply;
		exports.inject = ["slots", "remote", "remote.session", "uiWorkspace"];
		exports.prepareScratchDirectory = prepareScratchDirectory;
		exports.WhaleTailIcon = WhaleTailIcon;
		exports.startQuickSession = startQuickSession;
		return module.exports;
	}
});
