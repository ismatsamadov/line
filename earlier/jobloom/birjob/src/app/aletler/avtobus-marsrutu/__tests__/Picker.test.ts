import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mountComponent, type FoundElement } from '@/test/clientComponent';
import * as search from '../search';
import type { PickerItem } from '../Picker';

const FILE = fileURLToPath(new URL('../Picker.tsx', import.meta.url));
const Icon = () => null;
const icons = { Search: Icon, X: Icon, MapPin: Icon, MapPinned: Icon, LocateFixed: Icon };

type Props = {
  label: string; placeholder: string; emptyHint: string; searchItems: (query: string) => PickerItem[];
  selected: PickerItem | null; onSelect: (item: PickerItem | null) => void; onQueryChange?: (query: string) => void;
};
const row = (key: string, name: string): PickerItem => ({ key, name, detail: '' });
const stops = [row('s1', 'Gənclik küç. 120'), row('s2', 'Gənclik m/st')];
const places = [row('pn1', 'Gənclik · Metro stansiyası'), row('pn2', 'Gənclik · Kafe')];

function picker() {
  const view = mountComponent<Props>(FILE, { 'lucide-react': icons, './search': search });
  const base: Props = { label: 'Haradan', placeholder: '', emptyHint: '', searchItems: () => [], selected: null, onSelect: vi.fn() };
  // Each option's id is its position; its key, which React keeps apart, names the row.
  const rows = () => view.find(el => el.props.role === 'option').map(el => (el as FoundElement & { key: string }).key);
  const type = (text: string) => view.find((el: FoundElement) => el.type === 'input')[0].props.onChange({ target: { value: text } });
  return { view, base, rows, type };
}

beforeEach(() => {
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, getElementById: () => null });
});
afterEach(() => vi.unstubAllGlobals());

describe('the end picker (#720)', () => {
  it('keeps the rows shown for what is typed where they are when the places arrive', () => {
    const { view, base, rows, type } = picker();
    view.render(base);
    type('gənclik');
    // The stops answer at once.
    view.render({ ...base, searchItems: () => stops });
    expect(rows()).toEqual(['s1', 's2']);
    // The places a moment later, ranked above them: they go below the rows on screen.
    view.render({ ...base, searchItems: () => [places[0], ...stops, places[1]] });
    expect(rows()).toEqual(['s1', 's2', 'pn1', 'pn2']);
    // The next keystroke orders the list afresh.
    type('gənclik ');
    view.render({ ...base, searchItems: () => [places[0], ...stops, places[1]] });
    expect(rows()).toEqual(['pn1', 's1', 's2', 'pn2']);
  });

  it("never lists the last query's places as the new query's rows", () => {
    // The owner lists the places answered for the query it was told of, as EndPicker does.
    const { view, base, rows, type } = picker();
    const answers = new Map<string, PickerItem[]>();
    let told = '';
    const onQueryChange = (query: string) => { told = query; };
    const props = (): Props => ({ ...base, onQueryChange, searchItems: () => answers.get(told) ?? [] });
    view.render(props());
    type('avtovağzal');
    view.render(props());
    answers.set('avtovağzal', [row('pa1', 'Avtovağzal'), row('pa2', 'Avtovağzal Dairəsi')]);
    view.render(props());
    expect(rows()).toEqual(['pa1', 'pa2']);
    // Told in the same update, the owner has no places for the new query yet when the
    // picker first lists it; told an effect later, the old places became its first rows
    // and stayed there.
    type('palçıq');
    view.render(props());
    expect(rows()).toEqual([]);
    answers.set('palçıq', [row('pv1', 'Palçıq vulkanı')]);
    view.render(props());
    expect(rows()).toEqual(['pv1']);
  });
});
