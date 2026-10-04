'use server';
import { requireAdmin } from '@/lib/dashboard-auth';

import { createStudio } from '@/lib/content-create/studio';
import { withContentDatabase } from '@/lib/content-create/db';

const studio = createStudio();

// Return expected errors explicitly: production Server Actions intentionally
// hide thrown server messages, which would otherwise erase useful recovery copy.
async function result<T>(work: () => T | Promise<T>) {
  try { return { data: await withContentDatabase(work) }; }
  catch (error) { return { error: error instanceof Error ? error.message : 'Create could not finish that request. Please try again.' }; }
}

export async function loadContentStudio() {
    await requireAdmin(); return result(() => studio.state()); }
export async function saveContentDirection(input: Record<string, string>) {
    await requireAdmin(); return result(() => studio.saveDirection(input)); }
export async function generateMoreContentIdeas() {
    await requireAdmin(); return result(() => studio.ideas()); }
export async function generateContentPost(input: Record<string, unknown>) {
    await requireAdmin(); return result(() => studio.draft(input)); }
export async function saveContentPost(id: string, patch: Record<string, unknown>, expectedUpdatedAt: string) {
    await requireAdmin(); return result(() => studio.save(id, patch, expectedUpdatedAt)); }
export async function reviseContentPost(id: string, instruction: string, expectedUpdatedAt: string) {
    await requireAdmin(); return result(() => studio.revise(id, instruction, expectedUpdatedAt)); }
export async function recordContentFeedback(input: { postId?: string; ideaId?: string; kind: string; reason?: string; expectedUpdatedAt?: string }) {
    await requireAdmin(); return result(() => studio.feedback(input)); }
export async function restoreContentVersion(id: string, expectedUpdatedAt: string) {
    await requireAdmin(); return result(() => studio.restore(id, expectedUpdatedAt)); }
export async function markContentPublished(id: string, date: string) {
    await requireAdmin(); return result(() => studio.publish(id, date)); }
export async function scheduleContentPost(id: string, date: string) {
    await requireAdmin(); return result(() => studio.schedule(id, date)); }
export async function startContentFragment() {
    await requireAdmin(); return result(() => studio.manual()); }
