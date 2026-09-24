import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { LANGUAGES } from '@/lib/languages';
import { setTranslationLanguage, usePlayerStore } from '@/lib/player-store';

type Row = { kind: 'header'; title: string } | { kind: 'lang'; lang: string };

export default function LanguageScreen() {
  // The language shown for this song (translations only appear after an explicit pick).
  const current = usePlayerStore((s) => s.player?.translation?.lang ?? null);
  const mine = usePlayerStore((s) => s.prefs.languages);
  const [query, setQuery] = useState('');

  // The user's own languages (most relevant first), then everything else by global usage.
  const rows = useMemo((): Row[] => {
    const q = query.trim().toLowerCase();
    const matches = (l: string) => l.toLowerCase().includes(q);
    const yours = mine.filter(matches);
    const rest = LANGUAGES.filter((l) => matches(l) && !yours.includes(l));
    const out: Row[] = [];
    if (!q) out.push({ kind: 'lang', lang: 'Off' });
    if (yours.length) {
      out.push({ kind: 'header', title: 'Your languages' });
      yours.forEach((lang) => out.push({ kind: 'lang', lang }));
      if (rest.length) out.push({ kind: 'header', title: 'All languages' });
    }
    rest.forEach((lang) => out.push({ kind: 'lang', lang }));
    return out;
  }, [query, mine]);
  const firstMatch = rows.find((r): r is Extract<Row, { kind: 'lang' }> => r.kind === 'lang' && r.lang !== 'Off');

  const choose = (lang: string) => {
    void setTranslationLanguage(lang === 'Off' ? null : lang);
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 py-3">
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Search languages"
          accessibilityLabel="Search languages"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => firstMatch && query && choose(firstMatch.lang)}
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => (r.kind === 'header' ? `h:${r.title}` : r.lang)}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: row }) => {
          if (row.kind === 'header')
            return (
              <Text variant="muted" className="px-4 pb-1 pt-4 text-xs font-medium uppercase tracking-wide" role="heading">
                {row.title}
              </Text>
            );
          const item = row.lang;
          const selected = item === 'Off' ? current == null : item === current;
          return (
            <Pressable
              onPress={() => choose(item)}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              className="min-h-12 flex-row items-center justify-between px-4 py-3 active:bg-accent">
              <Text className={item === 'Off' ? 'text-muted-foreground' : undefined}>
                {item === 'Off' ? 'Off (original only)' : item}
              </Text>
              {selected && <Icon as={Check} size={18} />}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <Text variant="muted" className="px-4 py-6">
            No matching language.
          </Text>
        }
      />
    </View>
  );
}
