import { ArrowLeft, BookMarked, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BookShelfButtons, ReadingLogForm } from "@/components/books/book-controls";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db";
import { requireOwner } from "@/lib/auth/session";
import { startOfLocalWeek } from "@/lib/time";
import { BOOK_STATUS_LABELS, getBookshelf, type ShelfBook } from "@/modules/books/services/books";
import { CEFR_LEVELS, CEFR_LEVEL_LABELS } from "@/modules/curriculum/domain/cefr";
import { getLearnerSettings } from "@/modules/learner/services/profile";

export const metadata: Metadata = { title: "Books" };

export default function BooksPage() {
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/reading" className="inline-flex items-center gap-1.5 hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span lang="en">Reading</span> · 阅读
          </Link>
        }
        title="Books"
        titleZh="书单"
        description="按你的阅读水平推荐分级读物和原版书。泛读的关键是读得轻松、读得多：选一本几乎不用查词的书，每天读一会儿，读不下去就换一本。"
      />
      <Suspense fallback={<LoadingSkeleton label="正在加载书单…" />}>
        <Shelf />
      </Suspense>
    </>
  );
}

const dateFmt = (d: Date, timeZone: string) => new Intl.DateTimeFormat("zh-CN", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).format(d);

function BookCard({ book, timeZone, log = false }: { book: ShelfBook; timeZone: string; log?: boolean }) {
  const titleOnly = book.title;
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-col gap-1">
        <p lang="en" className="font-semibold text-ink">
          {book.title}
        </p>
        <p className="text-sm text-muted">{book.author}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge size="sm" tone="primary">
          {book.levelLabel}
        </Badge>
        <Badge size="sm" tone={book.kind === "graded_reader" ? "mint" : "blue"}>
          {book.kind === "graded_reader" ? "分级读物" : "原版书"}
        </Badge>
        {book.series ? (
          <Badge size="sm" tone="outline">
            <span lang="en">
              {book.series} · {book.seriesLevel}
            </span>
            {book.levelNote ? `（${book.levelNote}）` : null}
          </Badge>
        ) : null}
        <Badge size="sm">{book.genre === "fiction" ? "小说" : "非虚构"}</Badge>
        {book.tags.slice(0, 3).map((t) => (
          <Badge key={t} size="sm" tone="outline">
            {t}
          </Badge>
        ))}
      </div>
      <p className="text-sm text-ink">{book.summaryZh}</p>
      <p className="text-sm text-muted">
        <span className="font-medium text-ink">为什么推荐：</span>
        {book.whyZh}
      </p>
      {book.publicDomain ? (
        <p className="text-xs text-muted">
          {book.kind === "graded_reader" ? "原著已进入公版，简写版本身仍受版权保护。" : "已进入公版，可以免费读到原文。"}
          <a
            href={`https://www.gutenberg.org/ebooks/search/?query=${encodeURIComponent(titleOnly)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex min-h-6 items-center gap-1 font-medium text-primary-ink underline-offset-2 hover:underline"
          >
            在 Project Gutenberg 搜索原著
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </p>
      ) : null}
      {book.status ? (
        <p className="text-xs text-muted">
          {BOOK_STATUS_LABELS[book.status]}
          {book.startedAt && book.status !== "want" ? ` · ${dateFmt(book.startedAt, timeZone)} 开始` : ""}
          {book.finishedAt ? ` · ${dateFmt(book.finishedAt, timeZone)} 读完` : ""}
          {book.minutes > 0 ? ` · 共读了 ${book.minutes} 分钟` : ""}
          {book.pages > 0 ? ` · ${book.pages} 页` : ""}
        </p>
      ) : null}
      {log ? <ReadingLogForm bookId={book.id} title={book.title} /> : null}
      <BookShelfButtons bookId={book.id} title={book.title} status={book.status} />
    </li>
  );
}

function Section({ id, title, hint, books, timeZone, log }: { id: string; title: string; hint?: string; books: ShelfBook[]; timeZone: string; log?: boolean }) {
  if (books.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-base font-semibold text-ink">
          {title}
        </h2>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        {books.map((b) => (
          <BookCard key={b.id} book={b} timeZone={timeZone} log={log} />
        ))}
      </ul>
    </section>
  );
}

async function Shelf() {
  const user = await requireOwner();
  const db = getDb();
  const { profile } = await getLearnerSettings(db, user.id);
  const tz = profile.timezone;
  const shelf = await getBookshelf(db, user.id, startOfLocalWeek(new Date(), tz));

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <CardTitle>我的阅读</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <dl className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-surface-soft px-3 py-2">
              <dt className="text-muted">阅读水平</dt>
              <dd className="font-medium text-ink">
                约 {shelf.learner.label}
                <span className="ml-1 text-xs font-normal text-muted">（{shelf.learner.basis}）</span>
              </dd>
            </div>
            <div className="rounded-xl bg-surface-soft px-3 py-2">
              <dt className="text-muted">本周读书</dt>
              <dd className="font-medium text-ink">{shelf.stats.minutesThisWeek} 分钟</dd>
            </div>
            <div className="rounded-xl bg-surface-soft px-3 py-2">
              <dt className="text-muted">读完</dt>
              <dd className="font-medium text-ink">
                {shelf.stats.finished} 本<span className="ml-1 text-xs font-normal text-muted">（累计 {shelf.stats.minutesTotal} 分钟）</span>
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted">记录的读书时间计入每周的“意义输入”。书单只提供书目信息和推荐理由，不含书的内容；不同版本的级别可能不同，购买前请核对。</p>
        </CardContent>
      </Card>

      <Section id="bk-reading" title="在读" hint="读完一次就记一下时间；读完整本点“读完了”。" books={shelf.reading} timeZone={tz} log />
      {shelf.easy.length > 0 ? (
        <Section
          id="bk-easy"
          title="推荐给你：轻松读"
          hint={`和你现在的水平（约 ${shelf.learner.label}）相当或低一级。泛读要选几乎不用查词的书，读得快、读得多才最有用。`}
          books={shelf.easy}
          timeZone={tz}
        />
      ) : (
        <EmptyState icon={BookMarked} title="这个水平的推荐都在你的书架上了" description="可以在下面的“全部书单”里按等级挑选。" />
      )}
      <Section id="bk-stretch" title="想挑战一下" hint="比你现在的水平高一级，生词会多一些，适合配合查词慢慢读。" books={shelf.stretch} timeZone={tz} />
      <Section id="bk-want" title="想读" books={shelf.want} timeZone={tz} />
      <Section id="bk-finished" title="读完了" books={shelf.finished} timeZone={tz} />

      <section aria-labelledby="bk-all" className="flex flex-col gap-3">
        <h2 id="bk-all" className="text-base font-semibold text-ink">
          全部书单
        </h2>
        {CEFR_LEVELS.map((level) => {
          const list = shelf.all.filter((b) => b.level === level);
          if (list.length === 0) return null;
          return (
            <details key={level} className="group rounded-2xl border border-border bg-surface p-4" open={level === shelf.learner.level}>
              <summary className="flex min-h-6 cursor-pointer items-center justify-between gap-2 font-medium text-ink">
                {CEFR_LEVEL_LABELS[level]}
                <span className="text-sm font-normal text-muted">{list.length} 本</span>
              </summary>
              <ul className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
                {list.map((b) => (
                  <BookCard key={b.id} book={b} timeZone={tz} />
                ))}
              </ul>
            </details>
          );
        })}
      </section>
    </div>
  );
}
