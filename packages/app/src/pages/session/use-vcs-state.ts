import { createMemo, onCleanup } from "solid-js"
import { createQuery, skipToken } from "@tanstack/solid-query"
import { diffs as list } from "@/utils/diffs"

type ChangeMode = "git" | "branch" | "turn"
type VcsMode = "git" | "branch"

export const useVcsState = (input: {
  sync: {
    project?: { vcs?: string } | null
    data: { vcs?: { branch?: string; default_branch?: string } }
  }
  store: { changes: ChangeMode; mobileTab: string }
  sdk: {
    directory: string
    event: { listen: (handler: (evt: { details: { type: string; properties: unknown } }) => void) => () => void }
    client: { vcs: { diff: (req: { mode: VcsMode }) => Promise<{ data?: unknown[] }> } }
  }
  queryClient: { invalidateQueries: (opts: { queryKey: readonly unknown[] }) => void }
  isDesktop: () => boolean
  desktopFileTreeOpen: () => boolean
  desktopReviewOpen: () => boolean
  activeTab: () => string
  lastUserMessage: () => { summary?: { diffs?: unknown[] } } | undefined
}) => {
  const turnDiffs = createMemo(() => list(input.lastUserMessage()?.summary?.diffs))
  const nogit = createMemo(() => !!input.sync.project && input.sync.project.vcs !== "git")
  const changesOptions = createMemo<ChangeMode[]>(() => {
    const result: ChangeMode[] = []
    if (input.sync.project?.vcs === "git") result.push("git")
    if (
      input.sync.project?.vcs === "git" &&
      input.sync.data.vcs?.branch &&
      input.sync.data.vcs?.default_branch &&
      input.sync.data.vcs.branch !== input.sync.data.vcs.default_branch
    ) {
      result.push("branch")
    }
    result.push("turn")
    return result
  })
  const mobileChanges = createMemo(() => !input.isDesktop() && input.store.mobileTab === "changes")
  const wantsReview = createMemo(() =>
    input.isDesktop()
      ? input.desktopFileTreeOpen() || (input.desktopReviewOpen() && input.activeTab() === "review")
      : input.store.mobileTab === "changes",
  )
  const vcsMode = createMemo<VcsMode | undefined>(() => {
    if (input.store.changes === "git" || input.store.changes === "branch") return input.store.changes
  })
  const vcsKey = createMemo(
    () =>
      [
        "session-vcs",
        input.sdk.directory,
        input.sync.data.vcs?.branch ?? "",
        input.sync.data.vcs?.default_branch ?? "",
      ] as const,
  )
  const vcsQuery = createQuery(() => {
    const mode = vcsMode()
    const enabled = wantsReview() && input.sync.project?.vcs === "git"

    return {
      queryKey: [...vcsKey(), mode] as const,
      enabled,
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 60 * 1000,
      queryFn: mode
        ? () =>
            input.sdk.client.vcs
              .diff({ mode })
              .then((result) => list(result.data))
              .catch((error) => {
                console.debug("[session-review] failed to load vcs diff", { mode, error })
                return []
              })
        : skipToken,
    }
  })
  const refreshVcs = () => void input.queryClient.invalidateQueries({ queryKey: vcsKey() })

  const stopVcs = input.sdk.event.listen((evt) => {
    if (evt.details.type !== "file.watcher.updated") return
    const props =
      typeof evt.details.properties === "object" && evt.details.properties
        ? (evt.details.properties as Record<string, unknown>)
        : undefined
    const file = typeof props?.file === "string" ? props.file : undefined
    if (!file || file.startsWith(".git/")) return
    refreshVcs()
  })
  onCleanup(stopVcs)

  const reviewDiffs = () => {
    if (input.store.changes === "git" || input.store.changes === "branch")
      return vcsQuery.isFetched ? (vcsQuery.data ?? []) : []
    return turnDiffs()
  }
  const reviewCount = () => reviewDiffs().length
  const hasReview = () => reviewCount() > 0
  const reviewReady = () => {
    if (input.store.changes === "git" || input.store.changes === "branch") return !vcsQuery.isPending
    return true
  }

  return {
    nogit,
    changesOptions,
    mobileChanges,
    wantsReview,
    refreshVcs,
    reviewDiffs,
    reviewCount,
    hasReview,
    reviewReady,
  }
}
