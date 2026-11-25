// dsh-openstory-studio — client half.
//
// 把 OpenStory 工作台接成 DSH 的原生落点（与 dsh-open-design-studio 同形态）：
//   1) 左栏底部动作按钮（sidebar.footer.action）——点一下在右侧栏打开 OpenStory，
//      DSH 会话仍留在左边主区（不抢主面板、不换视图）；
//   2) 右侧栏标签页类型（sidebarRightTabs + sidebar.right.pane.tab）——可停靠、
//      可分栏、可用右侧栏自己的「全屏」按钮放大；右侧栏 guide 页里也有一张卡片。
//
// 面板以 ?embed=1 打开：OpenStory 进入嵌入模式，收掉它自带的 Agent 栏左列——
// 左侧的交给我 DSH 原本的会话，右侧只留工作台内容区。
//
// 宿主侧（index.mjs）负责把 http://127.0.0.1:8807 这个 daemon 拉起来并看护；
// 这里只做「先探测、再挂 iframe」——daemon 冷启动有几秒空窗，直接挂会停在
// ERR_CONNECTION_REFUSED 且不会自愈。
window.__ModuleLoader__.load({
	id: 'dsh-openstory-studio',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require('react');

		const ID = 'dsh-openstory-studio';
		const KIND = 'openstory';
		// ?embed=1 让 OpenStory 进入嵌入模式：宿主左侧已有真正的 DSH 会话，
		// 工作台收掉自带的 Agent 栏左列，只留内容区（见 public/index.html 的 html.os-embed）。
		const STUDIO_URL = 'http://127.0.0.1:8807/?embed=1';
		const STUDIO_ORIGIN = 'http://127.0.0.1:8807';
		const PROBE_TIMEOUT_MS = 10000;
		const PROBE_INTERVAL_MS = 700;
		const log = (...args) => { try { console.log('[openstory-studio]', ...args); } catch (_) {} };
		// apply() 时注入；按钮的回调从这里取 ctx（factory 每个页面只执行一次）。
		let pluginCtx = null;
		// 右侧栏 pane.tab 是 session scope，框架会把 DSH 当前会话的 inputActions 注入进来：
		// insertQuote = 把选段作为引用塞进 DSH 输入框（发送后就是 Markdown 引用块）。
		// 内嵌面板的「添加到 Agent」就靠它接到真正的 DSH 会话，而不是 OpenStory 自带 Agent。
		let dshInputActions = null;

		function useStudioReady() {
			const [phase, setPhase] = React.useState('waiting');
			const [nonce, setNonce] = React.useState(0);
			const [forced, setForced] = React.useState(false);

			React.useEffect(() => {
				let cancelled = false;
				let timer = null;
				const deadline = Date.now() + PROBE_TIMEOUT_MS;

				const probe = () => {
					if (cancelled) return;
					fetch(STUDIO_URL, { mode: 'no-cors', cache: 'no-store' }).then(
						() => { if (!cancelled) setPhase('ready'); },
						() => { if (cancelled) return; schedule(); }
					);
				};
				const schedule = () => {
					if (cancelled) return;
					if (Date.now() >= deadline) { setPhase('fallback'); return; }
					timer = setTimeout(probe, PROBE_INTERVAL_MS);
				};

				probe();
				return () => { cancelled = true; if (timer) clearTimeout(timer); };
			}, []);

			// 每次点击都换 key 重建 iframe：错误页不会自己重试。
			const open = () => {
				setForced(true);
				setNonce((value) => value + 1);
			};
			return { phase, nonce, forced, open };
		}

		function StudioFrame() {
			return React.createElement('iframe', {
				src: STUDIO_URL,
				title: 'OpenStory 小说工作台',
				allow: 'clipboard-read; clipboard-write; fullscreen',
				style: {
					width: '100%',
					height: '100%',
					minHeight: 0,
					border: 0,
					display: 'flex',
					background: 'var(--dsw-alias-bg-base, #ffffff)'
				}
			});
		}

		function StudioBody(props) {
			// 「添加到 Agent」的落点：记住框架注入的 DSH 输入框动作（session-scope 标准 prop）。
			const actions = props && props.inputActions;
			React.useEffect(() => {
				if (actions && typeof actions.insertQuote === 'function') dshInputActions = actions;
			}, [actions]);
			const { phase, nonce, forced, open } = useStudioReady();

			if (phase === 'ready' || forced) {
				return React.createElement(StudioFrame, { key: nonce });
			}

			const waiting = phase === 'waiting';
			return React.createElement('div', {
				style: {
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: 12,
					width: '100%',
					height: '100%',
					minHeight: 0,
					color: 'var(--dsw-alias-label-secondary, #8a8f98)',
					fontSize: 13,
					background: 'var(--dsw-alias-bg-base, #ffffff)'
				}
			},
				React.createElement('div', null, waiting ? '正在唤起 OpenStory…' : 'OpenStory 暂未响应'),
				React.createElement('div', { style: { opacity: 0.7 } },
					waiting ? '本机 daemon 随 DSH 启动，通常需要几秒' : '可以重试，或查看 ~/.dsh/logs/openstory-studio.log'),
				React.createElement('button', {
					type: 'button',
					onClick: open,
					style: {
						padding: '4px 14px',
						borderRadius: 6,
						border: '1px solid var(--dsw-alias-border-l2, #d8dbe0)',
						background: 'transparent',
						color: 'inherit',
						cursor: 'pointer',
						fontSize: 13
					}
				}, waiting ? '立即打开' : '重试')
			);
		}

		// 一本摊开的书：与 OpenDesign 的面板图标同一笔触（16px 线性）。
		function PanelIcon({ size = 16 }) {
			return React.createElement('svg', {
				width: size,
				height: size,
				viewBox: '0 0 16 16',
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 1.3,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
				'aria-hidden': 'true'
			},
				React.createElement('path', { d: 'M8 4.3c-1.3-1-3.3-1.2-4.6-.6v8c1.3-.5 3.3-.4 4.6.6' }),
				React.createElement('path', { d: 'M8 4.3c1.3-1 3.3-1.2 4.6-.6v8c-1.3-.5-3.3-.4-4.6.6' }),
				React.createElement('path', { d: 'M8 4.3v8' })
			);
		}

		// 在右侧栏打开 OpenStory 页面；主区的 DSH 会话保持不动。
		function openStory() {
			try {
				const right = pluginCtx && pluginCtx.sidebarRight;
				if (!right || typeof right.openTab !== 'function') {
					log('sidebarRight service missing; open skipped');
					return;
				}
				const mounted = right.mounted;
				let session;
				if (mounted && typeof mounted.getSnapshot === 'function') session = mounted.getSnapshot();
				else if (mounted && typeof mounted.get === 'function') session = mounted.get();
				if (mounted !== undefined && session === undefined) {
					log('no on-screen session; open skipped');
					return;
				}
				right.openTab(KIND);
			} catch (error) {
				log('open failed', error && error.message ? error.message : String(error));
			}
		}

		// ── 编辑器「添加到 Agent」→ DSH 当前会话输入框 ─────────────────────
		// OpenStory（iframe）postMessage 过来，这里调 DSH 注入的 inputActions：
		//   insertQuote → 选段成为输入框里的引用块（发送后是 Markdown 引用）
		//   insertText  → 可选提示语（如「润笔这段，要求：」）接在引用后面
		// 回 ack 让面板能区分「真的进了 DSH」和「DSH 没接住」。
		function replyToStudio(source, origin, requestId, ok, message) {
			try {
				if (source && typeof source.postMessage === 'function') {
					source.postMessage({ type: 'openstory/add-to-agent/ack', requestId, ok, message: message || '' }, origin);
				}
			} catch (error) {
				log('ack failed', error && error.message ? error.message : String(error));
			}
		}

		function attachAgentBridge() {
			const onMessage = (event) => {
				const data = event && event.data;
				if (!data || data.type !== 'openstory/add-to-agent') return;
				if (event.origin !== STUDIO_ORIGIN) return;
				const requestId = data.requestId;
				const quote = typeof data.quote === 'string' ? data.quote.replace(/\r\n?/gu, '\n').trim() : '';
				if (!quote) { replyToStudio(event.source, event.origin, requestId, false, '没有可添加的正文'); return; }
				const actions = dshInputActions;
				if (!actions || typeof actions.insertQuote !== 'function') {
					replyToStudio(event.source, event.origin, requestId, false, 'DSH 会话输入框还没就绪');
					return;
				}
				try {
					if (!actions.insertQuote(quote)) {
						replyToStudio(event.source, event.origin, requestId, false, 'DSH 输入框现在不能写（可能在生成中）');
						return;
					}
					const hint = typeof data.hint === 'string' ? data.hint.trim() : '';
					if (hint && typeof actions.insertText === 'function' && typeof actions.captureInsertion === 'function') {
						try {
							const span = actions.captureInsertion();
							if (span) actions.insertText(hint, span);
						} catch (error) {
							log('hint insert failed', error && error.message ? error.message : String(error));
						}
					}
					log('quote inserted into DSH composer');
					replyToStudio(event.source, event.origin, requestId, true, '已添加到 DSH 输入框');
				} catch (error) {
					const message = error && error.message ? error.message : String(error);
					log('agent bridge failed', message);
					replyToStudio(event.source, event.origin, requestId, false, message);
				}
			};
			window.addEventListener('message', onMessage);
			return () => { window.removeEventListener('message', onMessage); };
		}

		const FOOTER_CSS = [
			'.dsh-openstory-footer{display:flex;align-items:center;gap:8px;width:100%;height:34px;padding:0 10px;',
			'border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);',
			'font:inherit;font-size:13px;line-height:1;cursor:pointer;transition:background 120ms ease,color 120ms ease;}',
			'.dsh-openstory-footer:hover{background:var(--dsw-alias-bg-layer-2,#eceef1);',
			'color:var(--dsw-alias-label-primary,#111827);}',
			'.dsh-openstory-footer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#247bbf);outline-offset:1px;}',
			'.dsh-openstory-footer[data-rail]{width:36px;height:36px;justify-content:center;padding:0;margin:0 auto;}',
			'.dsh-openstory-footer span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
		].join('');

		function FooterAction({ wide }) {
			return React.createElement(React.Fragment, null,
				React.createElement('style', { 'data-openstory-footer': '' }, FOOTER_CSS),
				React.createElement('button', {
					type: 'button',
					className: 'dsh-openstory-footer',
					'data-rail': wide ? undefined : '',
					title: 'OpenStory',
					'aria-label': 'OpenStory',
					onClick: openStory
				},
					React.createElement(PanelIcon, { size: wide ? 16 : 18 }),
					wide ? React.createElement('span', null, 'OpenStory') : null
				)
			);
		}

		function safeEffect(ctx, label, fn) {
			ctx.effect(() => {
				try {
					const dispose = fn();
					log('registered', label);
					return dispose;
				} catch (error) {
					log('register failed', label, error && error.message ? error.message : String(error));
					return () => {};
				}
			}, ID + '.' + label);
		}

		function apply(ctx) {
			pluginCtx = ctx;
			log('apply called', Object.keys(ctx || {}).length, 'slots=', !!(ctx && ctx.slots));
			if (!ctx || !ctx.slots) return;

			// 1) 左栏底部按钮：打开右侧栏的 OpenStory，不动主区会话。
			safeEffect(ctx, 'footer-action', () => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
				name: 'sidebar.footer.action',
				id: ID,
				order: 90,
				label: () => 'OpenStory'
			}, FooterAction)));

			// 2) 「添加到 Agent」桥：面板 iframe → DSH 当前会话输入框
			safeEffect(ctx, 'agent-bridge', () => attachAgentBridge());

			// 2) 右侧栏标签页类型（guide 卡片 + 停靠页面）
			if (ctx.sidebarRightTabs) {
				safeEffect(ctx, 'right-type', () => ctx.sidebarRightTabs.register({
					id: ID,
					kind: KIND,
					title: () => 'OpenStory',
					guide: [{
						id: 'studio',
						order: 81,
						title: () => 'OpenStory',
						description: () => '本地小说创作工作台'
					}],
					keepMounted: true
				}));
			} else {
				log('sidebarRightTabs service missing, right-sidebar tab skipped');
			}

			safeEffect(ctx, 'right-body', () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
				name: 'sidebar.right.pane.tab',
				key: ID
			}, StudioBody)));
		}

		exports.apply = apply;
		exports.inject = ['slots', 'sidebarRightTabs', 'sidebarRight'];
		return module.exports;
	}
});
