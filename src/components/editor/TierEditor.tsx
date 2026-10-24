import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from './Card';
import { renderTierImage } from './renderImage';
import type { AnimeCardData } from '../../lib/data';
import {
  DEFAULT_TIERS,
  LIMITS,
  TIER_COLOR_PRESETS,
  VISIBILITY_LABELS,
  emptyTierList,
  type TierListData,
  type Visibility,
} from '../../lib/tierlist';

interface Props {
  seasonId: string;
  seasonLabel: string;
  anime: AnimeCardData[];
  /** サイト設定で画像表示が有効か（無効なら常に文字カード） */
  imageMode: boolean;
  siteName: string;
}

interface Meta {
  id: string | null;
  version: number;
  title: string;
  description: string;
  visibility: Visibility;
}

interface ApiTierList {
  id: string;
  title: string;
  description: string;
  visibility: Visibility;
  data: TierListData;
  version: number;
  updatedAt: number;
  username: string;
  isOwner: boolean;
}

interface Draft {
  data: TierListData;
  meta: Meta;
  savedAt: number;
}

const UNRANKED = 'unranked';
const CONTAINER_PREFIX = 'tier:';

function containerKey(tierId: string) {
  return CONTAINER_PREFIX + tierId;
}

function draftKey(seasonId: string, listId: string | null) {
  return `tier-draft:${seasonId}:${listId ?? 'new'}`;
}

function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft) {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // 保存できない環境（プライベートモード等）では何もしない
  }
}

function removeDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 何もしない
  }
}

function isLoggedIn(): boolean {
  return typeof document !== 'undefined' && /(?:^|; )li=/.test(document.cookie);
}

/** 季節の作品が増減しても壊れないよう、手元のデータを今の作品一覧に合わせる */
function reconcile(data: TierListData, ids: string[]): TierListData {
  const allowed = new Set(ids);
  const seen = new Set<string>();
  const keep = (list: string[]) => list.filter((id) => allowed.has(id) && !seen.has(id) && (seen.add(id), true));
  const tiers = data.tiers.map((t) => ({ ...t, items: keep(t.items) }));
  const unranked = keep(data.unranked);
  for (const id of ids) if (!seen.has(id)) unranked.push(id);
  return { tiers, unranked };
}

function newTierId() {
  return 't' + Math.random().toString(36).slice(2, 8);
}

// ---- 並べ替え可能なカード ----

function SortableCard(props: {
  anime: AnimeCardData;
  showImage: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.anime.id });
  return (
    <li
      ref={setNodeRef}
      className="ecard-wrap"
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
      aria-label={props.anime.title}
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect(props.anime.id);
      }}
    >
      <Card anime={props.anime} showImage={props.showImage} selected={props.selected} />
    </li>
  );
}

function DropZone(props: {
  id: string;
  items: string[];
  anime: Map<string, AnimeCardData>;
  showImage: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onZoneClick: () => void;
  className: string;
  emptyText?: string;
  filter?: (a: AnimeCardData) => boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  const visible = props.filter ? props.items.filter((id) => props.filter!(props.anime.get(id)!)) : props.items;
  return (
    <SortableContext items={props.items} strategy={rectSortingStrategy}>
      <ul
        ref={setNodeRef}
        className={`${props.className} ${isOver ? 'is-over' : ''} ${props.selectedId ? 'can-drop' : ''}`}
        onClick={props.onZoneClick}
      >
        {visible.map((id) => {
          const a = props.anime.get(id);
          return a ? (
            <SortableCard key={id} anime={a} showImage={props.showImage} selected={props.selectedId === id} onSelect={props.onSelect} />
          ) : null;
        })}
        {visible.length === 0 && props.emptyText && <li className="dz-empty">{props.emptyText}</li>}
      </ul>
    </SortableContext>
  );
}

// ---- 本体 ----

export default function TierEditor({ seasonId, seasonLabel, anime, imageMode, siteName }: Props) {
  const animeIds = useMemo(() => anime.map((a) => a.id), [anime]);
  const animeMap = useMemo(() => new Map(anime.map((a) => [a.id, a])), [anime]);
  const defaultTitle = `${seasonLabel} ティア表`;

  const [data, setData] = useState<TierListData>(() => emptyTierList(animeIds));
  const [meta, setMeta] = useState<Meta>({ id: null, version: 0, title: defaultTitle, description: '', visibility: 'public' });
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [showImages, setShowImages] = useState(imageMode);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; message?: string }>({ kind: 'idle' });
  const [owner, setOwner] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const draftKeyRef = useRef(draftKey(seasonId, null));

  // 初期化: URL の ?list=（自分のティア表の編集）/ ?from=（他の人のティア表をもとに作成）/ 下書き
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const listId = params.get('list');
    const fromId = params.get('from');
    setLoggedIn(isLoggedIn());
    if (imageMode) {
      try {
        setShowImages(localStorage.getItem('tier-show-images') !== '0');
      } catch {
        // 何もしない
      }
    }
    draftKeyRef.current = draftKey(seasonId, listId);
    const draft = readDraft(draftKeyRef.current);

    const load = async () => {
      if (listId) {
        const res = await fetch(`/api/tierlists/${encodeURIComponent(listId)}`);
        if (!res.ok) {
          setStatus({ kind: 'error', message: res.status === 404 ? 'ティア表が見つかりません' : '読み込みに失敗しました' });
          return;
        }
        const list = (await res.json()) as ApiTierList;
        if (!list.isOwner) {
          location.replace(`${location.pathname}?from=${encodeURIComponent(listId)}`);
          return;
        }
        // 下書きがサーバーより新しければ下書きを使う
        if (draft && draft.meta.version === list.version && draft.savedAt > list.updatedAt) {
          setData(reconcile(draft.data, animeIds));
          setMeta(draft.meta);
          setDirty(true);
        } else {
          setData(reconcile(list.data, animeIds));
          setMeta({ id: list.id, version: list.version, title: list.title, description: list.description, visibility: list.visibility });
        }
        setOwner(list.username);
      } else if (fromId) {
        const res = await fetch(`/api/tierlists/${encodeURIComponent(fromId)}`);
        if (res.ok) {
          const list = (await res.json()) as ApiTierList;
          setData(reconcile({ tiers: list.data.tiers.map((t) => ({ ...t })), unranked: list.data.unranked }, animeIds));
        }
      } else if (draft) {
        setData(reconcile(draft.data, animeIds));
        setMeta({ ...draft.meta, id: null, version: 0 });
        setDirty(true);
      }
    };
    load()
      .catch(() => setStatus({ kind: 'error', message: '読み込みに失敗しました' }))
      .finally(() => setReady(true));
  }, [seasonId, animeIds, imageMode]);

  // 変更を端末に自動保存（未ログインでも作業が消えないように）
  useEffect(() => {
    if (!ready || !dirty) return;
    const t = setTimeout(() => writeDraft(draftKeyRef.current, { data, meta, savedAt: Date.now() }), 400);
    return () => clearTimeout(t);
  }, [data, meta, ready, dirty]);

  // 保存していない変更があるときはページ離脱前に確認
  useEffect(() => {
    if (!dirty || !loggedIn) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, loggedIn]);

  const update = useCallback((fn: (d: TierListData) => TierListData) => {
    setData((d) => fn(d));
    setDirty(true);
    setStatus((s) => (s.kind === 'saved' ? { kind: 'idle' } : s));
  }, []);

  const updateMeta = (patch: Partial<Meta>) => {
    setMeta((m) => ({ ...m, ...patch }));
    setDirty(true);
  };

  // ---- ドラッグ&ドロップ ----

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = useCallback(
    (id: string, d: TierListData): string | null => {
      if (id === UNRANKED || id.startsWith(CONTAINER_PREFIX)) return id;
      if (d.unranked.includes(id)) return UNRANKED;
      const tier = d.tiers.find((t) => t.items.includes(id));
      return tier ? containerKey(tier.id) : null;
    },
    [],
  );

  const getItems = (d: TierListData, container: string) =>
    container === UNRANKED ? d.unranked : d.tiers.find((t) => containerKey(t.id) === container)?.items ?? [];

  const setItems = (d: TierListData, container: string, items: string[]): TierListData =>
    container === UNRANKED
      ? { ...d, unranked: items }
      : { ...d, tiers: d.tiers.map((t) => (containerKey(t.id) === container ? { ...t, items } : t)) };

  // カードの上を優先し、なければ行全体（空の行にも落とせるように）
  const collision: CollisionDetection = useCallback((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length) {
      const card = pointer.find((c) => !String(c.id).startsWith(CONTAINER_PREFIX) && c.id !== UNRANKED);
      return card ? [card] : pointer;
    }
    return closestCenter(args);
  }, []);

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setSelectedId(null);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    setData((d) => {
      const from = findContainer(activeKey, d);
      const to = findContainer(overKey, d);
      if (!from || !to || from === to) return d;
      const fromItems = getItems(d, from).filter((id) => id !== activeKey);
      const toItems = [...getItems(d, to)];
      const overIndex = toItems.indexOf(overKey);
      toItems.splice(overIndex >= 0 ? overIndex : toItems.length, 0, activeKey);
      return setItems(setItems(d, from, fromItems), to, toItems);
    });
    setDirty(true);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    update((d) => {
      const container = findContainer(activeKey, d);
      if (!container || container !== findContainer(overKey, d)) return d;
      const items = getItems(d, container);
      const oldIndex = items.indexOf(activeKey);
      const newIndex = items.indexOf(overKey);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return d;
      return setItems(d, container, arrayMove(items, oldIndex, newIndex));
    });
  };

  // ---- タップ操作（スマホ向け: カードを選んでから行をタップ） ----

  const onSelect = (id: string) => {
    if (selectedId && selectedId !== id) {
      // 選択中のカードを、タップしたカードの位置へ移す
      const target = id;
      const moving = selectedId;
      update((d) => {
        const from = findContainer(moving, d)!;
        const to = findContainer(target, d)!;
        let next = setItems(d, from, getItems(d, from).filter((x) => x !== moving));
        const toItems = [...getItems(next, to)];
        toItems.splice(toItems.indexOf(target), 0, moving);
        next = setItems(next, to, toItems);
        return next;
      });
      setSelectedId(null);
      return;
    }
    setSelectedId((s) => (s === id ? null : id));
  };

  const moveSelectedTo = (container: string) => {
    if (!selectedId) return;
    const moving = selectedId;
    update((d) => {
      const from = findContainer(moving, d)!;
      const next = setItems(d, from, getItems(d, from).filter((x) => x !== moving));
      return setItems(next, container, [...getItems(next, container), moving]);
    });
    setSelectedId(null);
  };

  // ---- ティアの編集 ----

  const editTier = (id: string, patch: { label?: string; color?: string }) =>
    update((d) => ({ ...d, tiers: d.tiers.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

  const moveTier = (id: string, dir: -1 | 1) =>
    update((d) => {
      const i = d.tiers.findIndex((t) => t.id === id);
      const j = i + dir;
      if (j < 0 || j >= d.tiers.length) return d;
      return { ...d, tiers: arrayMove(d.tiers, i, j) };
    });

  const removeTier = (id: string) => {
    update((d) => {
      if (d.tiers.length <= 1) return d;
      const tier = d.tiers.find((t) => t.id === id)!;
      return { tiers: d.tiers.filter((t) => t.id !== id), unranked: [...tier.items, ...d.unranked] };
    });
    setEditingTier(null);
  };

  const addTier = () =>
    update((d) =>
      d.tiers.length >= LIMITS.maxTiers
        ? d
        : { ...d, tiers: [...d.tiers, { id: newTierId(), label: '新しいティア', color: TIER_COLOR_PRESETS[d.tiers.length % TIER_COLOR_PRESETS.length], items: [] }] },
    );

  const resetAll = () => {
    if (!confirm('すべての作品を未分類に戻し、ティアを初期状態にしますか？')) return;
    update(() => ({ tiers: DEFAULT_TIERS.map((t) => ({ ...t, items: [] })), unranked: [...animeIds] }));
  };

  const toggleImages = () => {
    setShowImages((v) => {
      try {
        localStorage.setItem('tier-show-images', v ? '0' : '1');
      } catch {
        // 何もしない
      }
      return !v;
    });
  };

  // ---- 保存・共有 ----

  const save = async () => {
    if (!loggedIn) {
      writeDraft(draftKeyRef.current, { data, meta, savedAt: Date.now() });
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    setStatus({ kind: 'saving' });
    const body = JSON.stringify({ seasonId, title: meta.title, description: meta.description, visibility: meta.visibility, data, version: meta.version });
    const res = await fetch(meta.id ? `/api/tierlists/${meta.id}` : '/api/tierlists', {
      method: meta.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => null);
    if (!res) {
      setStatus({ kind: 'error', message: '通信に失敗しました。時間をおいてもう一度お試しください' });
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string; id: string; version: number; username: string };
    if (res.status === 401) {
      setLoggedIn(false);
      setStatus({ kind: 'error', message: 'ログインの有効期限が切れました。もう一度ログインしてください' });
      return;
    }
    if (!res.ok) {
      setStatus({ kind: 'error', message: json.error ?? '保存に失敗しました' });
      return;
    }
    removeDraft(draftKeyRef.current);
    removeDraft(draftKey(seasonId, null));
    draftKeyRef.current = draftKey(seasonId, json.id);
    setMeta((m) => ({ ...m, id: json.id, version: json.version }));
    setOwner(json.username);
    setDirty(false);
    setStatus({ kind: 'saved' });
    if (!new URLSearchParams(location.search).get('list')) {
      history.replaceState(null, '', `${location.pathname}?list=${json.id}`);
    }
  };

  const shareUrl = meta.id ? `${location.origin}/t/${meta.id}` : null;
  const shareText = `${meta.title} #アニメティア表 #${seasonLabel.replace(/\s/g, '')}`;

  const download = async () => {
    const blob = await renderTierImage({
      data,
      anime: animeMap,
      showImages: imageMode && showImages,
      title: meta.title,
      subtitle: seasonLabel,
      footer: `${siteName} ${location.host}`,
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${seasonId}-tierlist.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const nativeShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.share({ title: meta.title, text: shareText, url: shareUrl });
    } catch {
      // キャンセル時は何もしない
    }
  };

  const copyUrl = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setStatus({ kind: 'saved', message: 'URL をコピーしました' });
  };

  const filter = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? (a: AnimeCardData) => a.title.toLowerCase().includes(q) : undefined;
  }, [query]);

  const showImg = imageMode && showImages;
  const activeAnime = activeId ? animeMap.get(activeId) : null;
  const ranked = data.tiers.reduce((n, t) => n + t.items.length, 0);

  return (
    <div className={`editor ${ready ? '' : 'is-loading'}`} onClick={() => setSelectedId(null)}>
      <div className="editor-toolbar row">
        <span className="muted small">
          {ranked} / {animeIds.length} 作品を配置
        </span>
        <span className="spacer" />
        {imageMode && (
          <button type="button" className="btn btn-sm" onClick={toggleImages} aria-pressed={!showImages}>
            {showImages ? '文字で表示' : '画像で表示'}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={addTier} disabled={data.tiers.length >= LIMITS.maxTiers}>
          ティアを追加
        </button>
        <button type="button" className="btn btn-sm" onClick={resetAll}>
          リセット
        </button>
      </div>

      {selectedId && (
        <p className="notice small" role="status">
          「{animeMap.get(selectedId)?.title}」を選択中。移動先の行をタップしてください。
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="tier-table editor-table">
          {data.tiers.map((tier, i) => (
            <div className="tier-row" key={tier.id}>
              <button
                type="button"
                className="tier-label"
                style={{ background: tier.color }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectedId) moveSelectedTo(containerKey(tier.id));
                  else setEditingTier(editingTier === tier.id ? null : tier.id);
                }}
                aria-label={`${tier.label} の設定`}
              >
                {tier.label || ' '}
              </button>
              <DropZone
                id={containerKey(tier.id)}
                items={tier.items}
                anime={animeMap}
                showImage={showImg}
                selectedId={selectedId}
                onSelect={onSelect}
                onZoneClick={() => moveSelectedTo(containerKey(tier.id))}
                className="tier-items dz"
              />
              {editingTier === tier.id && (
                <div className="tier-settings card" onClick={(e) => e.stopPropagation()}>
                  <div className="field">
                    <label htmlFor={`label-${tier.id}`}>ティア名</label>
                    <input
                      id={`label-${tier.id}`}
                      type="text"
                      value={tier.label}
                      maxLength={LIMITS.maxLabel}
                      onChange={(e) => editTier(tier.id, { label: e.target.value })}
                    />
                  </div>
                  <div className="colors" role="radiogroup" aria-label="色">
                    {TIER_COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={tier.color === c}
                        aria-label={c}
                        className={`swatch ${tier.color === c ? 'is-on' : ''}`}
                        style={{ background: c }}
                        onClick={() => editTier(tier.id, { color: c })}
                      />
                    ))}
                  </div>
                  <div className="row">
                    <button type="button" className="btn btn-sm" onClick={() => moveTier(tier.id, -1)} disabled={i === 0}>
                      上へ
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => moveTier(tier.id, 1)} disabled={i === data.tiers.length - 1}>
                      下へ
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeTier(tier.id)} disabled={data.tiers.length <= 1}>
                      削除
                    </button>
                    <span className="spacer" />
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditingTier(null)}>
                      閉じる
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <section className="tray card" aria-label="未分類の作品">
          <div className="row tray-head">
            <h2 className="tray-title">未分類（{data.unranked.length}）</h2>
            <span className="spacer" />
            <input
              type="text"
              className="tray-search"
              placeholder="作品名で絞り込み"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              aria-label="作品名で絞り込み"
            />
          </div>
          <DropZone
            id={UNRANKED}
            items={data.unranked}
            anime={animeMap}
            showImage={showImg}
            selectedId={selectedId}
            onSelect={onSelect}
            onZoneClick={() => moveSelectedTo(UNRANKED)}
            className="tray-items dz"
            emptyText={filter ? '該当する作品はありません' : 'すべての作品を配置しました'}
            filter={filter}
          />
          <p className="muted small tray-help">
            ドラッグして各ティアへ。スマホではカードをタップして選び、移動先の行をタップしても動かせます。
          </p>
        </section>

        <DragOverlay>{activeAnime ? <Card anime={activeAnime} showImage={showImg} dragging /> : null}</DragOverlay>
      </DndContext>

      <section className="save-panel card" onClick={(e) => e.stopPropagation()} aria-label="保存と共有">
        <div className="field">
          <label htmlFor="tl-title">タイトル</label>
          <input id="tl-title" type="text" value={meta.title} maxLength={LIMITS.maxTitle} onChange={(e) => updateMeta({ title: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="tl-desc">ひとこと（任意）</label>
          <textarea id="tl-desc" value={meta.description} maxLength={LIMITS.maxDescription} onChange={(e) => updateMeta({ description: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="tl-vis">公開範囲</label>
          <select id="tl-vis" value={meta.visibility} onChange={(e) => updateMeta({ visibility: e.target.value as Visibility })}>
            {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={save} disabled={status.kind === 'saving' || !ready}>
            {status.kind === 'saving' ? '保存中…' : loggedIn ? (meta.id ? '上書き保存' : '保存する') : 'ログインして保存'}
          </button>
          <button type="button" className="btn" onClick={download}>
            画像をダウンロード
          </button>
          {dirty && meta.id && <span className="muted small">未保存の変更があります</span>}
        </div>
        {status.kind === 'error' && (
          <p className="error small" role="alert">
            {status.message}
          </p>
        )}
        {status.kind === 'saved' && (
          <p className="small" role="status">
            {status.message ?? '保存しました。'}
          </p>
        )}
        {!loggedIn && <p className="muted small">ログインしなくても作成と画像ダウンロードはできます。作業内容はこの端末に自動で保存されます。</p>}

        {shareUrl && !dirty && (
          <div className="share stack">
            {meta.visibility === 'private' ? (
              <p className="notice">非公開のため、このティア表はあなたにしか見えません。共有するには公開範囲を変更して保存してください。</p>
            ) : (
              <>
                <div className="row">
                  <a className="btn btn-sm" href={shareUrl} target="_blank" rel="noopener">
                    公開ページを見る
                  </a>
                  <a
                    className="btn btn-sm"
                    href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
                    target="_blank"
                    rel="noopener"
                  >
                    X でポスト
                  </a>
                  <a className="btn btn-sm" href={`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener">
                    LINE で送る
                  </a>
                  <a className="btn btn-sm" href={`https://bsky.app/intent/compose?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} target="_blank" rel="noopener">
                    Bluesky
                  </a>
                  <button type="button" className="btn btn-sm" onClick={copyUrl}>
                    URL をコピー
                  </button>
                  {typeof navigator !== 'undefined' && 'share' in navigator && (
                    <button type="button" className="btn btn-sm" onClick={nativeShare}>
                      その他で共有
                    </button>
                  )}
                </div>
                {owner && (
                  <p className="muted small">
                    <a href="/me">マイページ</a>で保存したティア表を管理できます。
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
