import { expect, test } from 'vitest'
import { accountMode, passwordLink, passwordRules, validUsername } from './account-access'

test('account routes are explicit and do not consume unrelated private routes', () => {
  expect(accountMode('/login')).toBe('login')
  expect(accountMode('/signup/')).toBe('signup')
  expect(accountMode('/settings/security')).toBe('change')
  expect(accountMode('/forgot-password')).toBe('forgot')
  expect(accountMode('/activate-password')).toBe('activate')
  expect(accountMode('/reset-password')).toBe('reset')
  expect(accountMode('/settings')).toBeUndefined()
  expect(accountMode('/agenda/new')).toBeUndefined()
})

test.each([
  ['', [false, false, false]],
  ['shortA1', [false, true, true]],
  ['lower123', [true, false, true]],
  ['CapitalOnly', [true, true, false]],
  ['Orbit482', [true, true, true]],
  ['ORBIT482', [true, true, true]],
  ['Orbit482!', [true, true, true]],
])('password requirements reflect the agreed minimum, uppercase and digit policy', (value, result) => {
  expect(passwordRules(value).map(rule => rule.met)).toEqual(result)
})

test('username presentation validation accepts only the documented 3-30 characters', () => {
  for (const username of ['new.owner', 'new_owner2', 'MixedCase']) expect(validUsername(username)).toBe(true)
  for (const username of ['', 'ab', 'has space', 'email@example.invalid', 'x'.repeat(31)]) expect(validUsername(username)).toBe(false)
})

test('link tokens are accepted only from the exact fragment format and never coerced', () => {
  expect(passwordLink(`#token=${'x'.repeat(43)}`)).toBe('x'.repeat(43))
  for (const hash of ['', '#arbitrary', '#token=short', `#token=${'x'.repeat(44)}`, `#token=${'/'.repeat(43)}`]) expect(passwordLink(hash)).toBe('')
})
