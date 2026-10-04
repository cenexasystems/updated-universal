import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { normalizePhoneForWhatsApp } from '../lib/phone'

export interface CustomerBirthday {
  id: string
  name: string
  phone: string
  birth_date: string // YYYY-MM-DD
  created_at?: string
}

export interface BirthdayOffer {
  id: string
  label: string
}

export type BirthdayRange = 'today' | 'week' | 'month' | 'year' | 'all'

const LOCAL_KEY = 'universallook_birthdays_v1'
const OFFERS_KEY = 'universallook_birthday_offers_v1'
const TEMPLATE_KEY = 'universallook_birthday_template_v1'

export const DEFAULT_TEMPLATE =
  'Hi {name}! 🎂 Happy Birthday!\n\nHere\'s a special treat from Universal Look:\n🎁 {offer}\n\nVisit us in store or call +91 91596 00067.\nFollow us on Instagram @universallook600067\n\n– Universal Look'

const DEFAULT_OFFERS: BirthdayOffer[] = [{ id: 'default-20', label: '20% OFF' }]

const readLocal = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}
const writeLocal = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
}

const phoneKey = (phone: string) => normalizePhoneForWhatsApp(phone) || phone.trim()

export const birthdayService = {
  async list(): Promise<CustomerBirthday[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('customer_birthdays')
        .select('id, name, phone, birth_date, created_at')
        .order('name', { ascending: true })
      if (!error && data) return data as CustomerBirthday[]
      console.warn('Birthday fetch failed, using local cache:', error?.message)
    }
    return readLocal<CustomerBirthday[]>(LOCAL_KEY, [])
  },

  /** Insert or update the birthday for a phone number. Never throws: billing must not fail because of this. */
  async save(input: { name: string; phone: string; birthDate: string }): Promise<void> {
    const phone = phoneKey(input.phone)
    if (!phone || !input.birthDate) return
    const row = { name: input.name.trim(), phone, birth_date: input.birthDate, updated_at: new Date().toISOString() }
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('customer_birthdays').upsert(row, { onConflict: 'phone' })
      if (!error) return
      console.warn('Birthday save failed, caching locally:', error.message)
    }
    const all = readLocal<CustomerBirthday[]>(LOCAL_KEY, []).filter(b => b.phone !== phone)
    all.push({ id: `local-${phone}`, name: row.name, phone, birth_date: row.birth_date })
    writeLocal(LOCAL_KEY, all)
  },

  async remove(id: string): Promise<void> {
    if (!id.startsWith('local-') && isSupabaseConfigured) {
      const { error } = await supabase.from('customer_birthdays').delete().eq('id', id)
      if (error) throw new Error(error.message)
    }
    writeLocal(LOCAL_KEY, readLocal<CustomerBirthday[]>(LOCAL_KEY, []).filter(b => b.id !== id))
  },

  getOffers: (): BirthdayOffer[] => {
    const offers = readLocal<BirthdayOffer[]>(OFFERS_KEY, [])
    return offers.length ? offers : DEFAULT_OFFERS
  },
  saveOffers: (offers: BirthdayOffer[]) => writeLocal(OFFERS_KEY, offers),
  getTemplate: (): string => readLocal<string>(TEMPLATE_KEY, DEFAULT_TEMPLATE),
  saveTemplate: (t: string) => writeLocal(TEMPLATE_KEY, t),
}

const pad = (n: number) => String(n).padStart(2, '0')
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** DD/MM/YYYY for display. */
export const formatBirthDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

/** Next date (>= today) on which this birthday falls, ignoring birth year. */
export const nextBirthday = (iso: string, today = new Date()): Date => {
  const [, m, d] = iso.split('-').map(Number)
  const base = new Date(today.getFullYear(), 0, 1)
  const make = (year: number) => {
    // Feb 29 → Feb 28 on non-leap years
    const dt = new Date(year, m - 1, d)
    return dt.getMonth() !== m - 1 ? new Date(year, m - 1, d - 1) : dt
  }
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  let next = make(base.getFullYear())
  if (next < startOfToday) next = make(base.getFullYear() + 1)
  return next
}

/** Whether the birthday's next occurrence falls in [from, to] (inclusive, ISO dates; either may be empty). */
export const birthdayInWindow = (iso: string, from: string, to: string, today = new Date()) => {
  const next = toIsoDate(nextBirthday(iso, today))
  if (from && next < from) return false
  if (to && next > to) return false
  return true
}

export const rangeToDates = (range: BirthdayRange, today = new Date()): { from: string; to: string } => {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  switch (range) {
    case 'today': return { from: toIsoDate(t), to: toIsoDate(t) }
    case 'week': return { from: toIsoDate(t), to: toIsoDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 6)) }
    case 'month': return {
      from: toIsoDate(new Date(t.getFullYear(), t.getMonth(), 1)),
      to: toIsoDate(new Date(t.getFullYear(), t.getMonth() + 1, 0)),
    }
    case 'year': return { from: toIsoDate(t), to: `${t.getFullYear()}-12-31` }
    default: return { from: '', to: '' }
  }
}

export const buildBirthdayMessage = (template: string, name: string, offer: string) =>
  template.replace(/\{name\}/g, name.trim() || 'Customer').replace(/\{offer\}/g, offer)
