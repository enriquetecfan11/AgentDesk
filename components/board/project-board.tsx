'use client';

import { ChevronDown } from 'lucide-react';
import type { DragEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { BoardCard } from '@/components/board/board-card';
import { dropProject, dropZoneAt } from '@/components/board/use-touch-drag';
import { BOARD_STATUSES, TASK_STATUS_META } from '@/lib/constants';
import type { TaskStatusValue } from '@/lib/constants';
import type { ProjectDTO, TaskDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

const NONE_LANE = '__none__';

/** localStorage key for collapsed project boards. */
const STORAGE_KEY = 'agentdesk.board.collapsed';

/** Column titles for the board; the review column reads better as "En revisión". */
const COLUMN_LABEL: Partial<Record<TaskStatusValue, string>> = {
  review: 'En revisión',
  done: 'Completado',
};

/**
 * Column widths, one board per project.
 *
 * Each project is its own horizontal scroller, so the page never overflows:
 *  - móvil: una columna ancha con un asomo de la siguiente (pista de scroll);
 *  - tablet: dos columnas completas;
 *  - escritorio: tres, cuatro y hasta cinco columnas, repartiendo el ancho.
 */
const COLUMN_WIDTH =
  'w-[86%] sm:w-[calc(50%_-_0.375rem)] lg:w-[calc(33.333%_-_0.5rem)] xl:w-[calc(25%_-_0.5625rem)] 2xl:w-[calc(20%_-_0.6rem)]';

type Lane = {
  key: string;
  projectId: string | null;
  name: string;
  color: string | null;
  /** Board-wide totals from the project record, independent of the filters. */
  done: number;
  total: number;
};

type DropTarget = { projectId: string | null; status: TaskStatusValue; index: number };

function bySortOrder(a: TaskDTO, b: TaskDTO) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

/**
 * One Kanban per project, stacked vertically. Each board scrolls horizontally
 * on its own and its columns size to their content, so nothing gets cut and
 * there is no leftover empty space.
 */
export function ProjectBoard({
  tasks,
  projects,
  onOpen,
  onMove,
}: {
  tasks: TaskDTO[];
  projects: ProjectDTO[];
  onOpen: (task: TaskDTO) => void;
  onMove: (id: string, status: TaskStatusValue, index: number, projectId: string | null) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // Read once on mount: rendering with the default (all expanded) first keeps
  // the SSR and hydration passes identical.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // A corrupt value must never break the board.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
      // Quota errors are non-fatal; the collapse state is cosmetic.
    }
  }, [collapsed, hydrated]);

  const lanes = useMemo<Lane[]>(() => {
    const noneTasks = tasks.filter((task) => task.projectId === null);
    return [
      ...projects.map((project) => ({
        key: project.id,
        projectId: project.id,
        name: project.name,
        color: project.color,
        done: project.taskDone,
        total: project.taskTotal,
      })),
      {
        key: NONE_LANE,
        projectId: null,
        name: 'Sin proyecto',
        color: null,
        done: noneTasks.filter((task) => task.status === 'done').length,
        total: noneTasks.length,
      },
    ];
  }, [projects, tasks]);

  function commitDrop() {
    if (draggingId && dropTarget) {
      onMove(draggingId, dropTarget.status, dropTarget.index, dropTarget.projectId);
    }
    setDraggingId(null);
    setDropTarget(null);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2 p-3">
        {lanes.map((lane) => {
          const laneTasks = tasks.filter(
            (task) => task.projectId === lane.projectId && task.status !== 'cancelled',
          );

          return (
            <ProjectLane
              key={lane.key}
              lane={lane}
              laneTasks={laneTasks}
              isCollapsed={collapsed[lane.key] ?? false}
              onToggle={() =>
                setCollapsed((current) => ({ ...current, [lane.key]: !current[lane.key] }))
              }
              draggingId={draggingId}
              dropTarget={dropTarget}
              onOpen={onOpen}
              onMove={onMove}
              setDraggingId={setDraggingId}
              setDropTarget={setDropTarget}
              commitDrop={commitDrop}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProjectLane({
  lane,
  laneTasks,
  isCollapsed,
  onToggle,
  draggingId,
  dropTarget,
  onOpen,
  onMove,
  setDraggingId,
  setDropTarget,
  commitDrop,
}: {
  lane: Lane;
  laneTasks: TaskDTO[];
  isCollapsed: boolean;
  onToggle: () => void;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  onOpen: (task: TaskDTO) => void;
  onMove: (id: string, status: TaskStatusValue, index: number, projectId: string | null) => void;
  setDraggingId: (value: string | null) => void;
  setDropTarget: (value: DropTarget | null) => void;
  commitDrop: () => void;
}) {
  const pct = lane.total > 0 ? Math.round((lane.done / lane.total) * 100) : 0;

  function resetDrag() {
    setDraggingId(null);
    setDropTarget(null);
  }

  /** Touch has no hover, so it always drops at the end of the column. */
  function touchMove(x: number, y: number) {
    const zone = dropZoneAt(x, y);
    const status = zone?.dataset.dropStatus as TaskStatusValue | undefined;
    const projectId = dropProject(zone, NONE_LANE);
    if (status && projectId !== undefined) {
      setDropTarget({ projectId, status, index: Number.MAX_SAFE_INTEGER });
    }
  }

  function touchDrop(taskId: string, x: number, y: number) {
    const zone = dropZoneAt(x, y);
    const status = zone?.dataset.dropStatus as TaskStatusValue | undefined;
    const projectId = dropProject(zone, NONE_LANE);
    if (status && projectId !== undefined) {
      onMove(taskId, status, Number.MAX_SAFE_INTEGER, projectId);
    }
    resetDrag();
  }

  return (
    <section className="flex flex-col">
      {/* Sticky per section: the name stays visible while its cards scroll. */}
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!isCollapsed}
          className="flex min-w-0 items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={isCollapsed ? 'Expandir' : 'Plegar'}
        >
          <ChevronDown
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              isCollapsed && '-rotate-90',
            )}
          />
          {lane.color ? (
            <span className="size-2.5 shrink-0 rounded-[4px]" style={{ background: lane.color }} />
          ) : (
            <span className="size-2.5 shrink-0 rounded-[4px] border border-dashed border-muted-foreground" />
          )}
          <h2 className="truncate text-sm font-medium">{lane.name}</h2>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {laneTasks.length}
          </span>
        </button>

        {lane.total > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className="relative hidden h-1 w-14 overflow-hidden rounded-full bg-muted sm:block">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-emerald-500"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {lane.done}/{lane.total}
            </span>
          </span>
        )}
      </header>

      {/* Independent horizontal scroll: only this board moves sideways. */}
      {!isCollapsed && (
        <div className="overflow-x-auto pb-1">
          <div className="flex items-start gap-3">
            {BOARD_STATUSES.map((status) => {
              const columnTasks = laneTasks
                .filter((task) => task.status === status)
                .sort(bySortOrder);
              // The dragged card stays mounted so a touch pointer keeps its
              // capture; only the drop math ignores it.
              const remaining = columnTasks.filter((task) => task.id !== draggingId);
              const meta = TASK_STATUS_META[status];
              const label = COLUMN_LABEL[status] ?? meta.label;
              const isDropColumn =
                dropTarget?.projectId === lane.projectId && dropTarget.status === status;

              return (
                <section
                  key={status}
                  aria-label={`${label} — ${lane.name}`}
                  data-drop-status={status}
                  data-drop-project={lane.projectId ?? NONE_LANE}
                  className={cn(
                    'flex shrink-0 flex-col rounded-lg border bg-muted/20',
                    COLUMN_WIDTH,
                    isDropColumn ? 'border-ring/60 bg-accent-muted/40' : 'border-border',
                  )}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropTarget({
                      projectId: lane.projectId,
                      status,
                      index: remaining.length,
                    });
                  }}
                  onDrop={(event: DragEvent<HTMLElement>) => {
                    event.preventDefault();
                    commitDrop();
                  }}
                >
                  <header className="flex h-7 shrink-0 items-center gap-1.5 px-2.5">
                    <span className={cn('size-1.5 rounded-full', meta.dot)} />
                    <h3 className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {label}
                    </h3>
                    <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                      {columnTasks.length}
                    </span>
                  </header>

                  <div className="flex flex-1 flex-col gap-1.5 px-2 pb-2">
                    {columnTasks.length === 0 && (
                      <p
                        className={cn(
                          'rounded-md border border-dashed px-1 py-3 text-center text-[11px]',
                          isDropColumn
                            ? 'border-ring/60 text-foreground'
                            : 'border-border/70 text-muted-foreground',
                        )}
                      >
                        {isDropColumn ? 'Suelta aquí' : 'Sin tareas'}
                      </p>
                    )}

                    {columnTasks.map((task) => {
                      const position = remaining.findIndex((item) => item.id === task.id);

                      return (
                        <BoardCard
                          key={task.id}
                          task={task}
                          dragging={draggingId === task.id}
                          onOpen={onOpen}
                          onMove={(target) =>
                            onMove(task.id, target, Number.MAX_SAFE_INTEGER, lane.projectId)
                          }
                          onDragStart={() => setDraggingId(task.id)}
                          onDragEnd={resetDrag}
                          onCardDragOver={() => {
                            setDropTarget({
                              projectId: lane.projectId,
                              status,
                              index: position === -1 ? remaining.length : position,
                            });
                          }}
                          showDropBefore={
                            isDropColumn && position !== -1 && dropTarget?.index === position
                          }
                          onDrop={(event) => {
                            event.stopPropagation();
                            commitDrop();
                          }}
                          onTouchStart={() => {
                            setDraggingId(task.id);
                            setDropTarget({
                              projectId: lane.projectId,
                              status,
                              index: Number.MAX_SAFE_INTEGER,
                            });
                          }}
                          onTouchMove={touchMove}
                          onTouchDrop={(x, y) => touchDrop(task.id, x, y)}
                          onTouchCancel={resetDrag}
                        />
                      );
                    })}

                    {isDropColumn && dropTarget !== null && dropTarget.index >= remaining.length && (
                      <div className="h-0.5 rounded-full bg-accent" />
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
