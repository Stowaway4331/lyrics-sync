import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { setTranslationLanguage, usePlayerStore } from '@/lib/player-store';

const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Swedish', 'Polish',
  'Russian', 'Ukrainian', 'Turkish', 'Arabic', 'Hebrew', 'Hindi', 'Bengali', 'Urdu', 'Tamil',
  'Indonesian', 'Vietnamese', 'Thai', 'Tagalog', 'Japanese', 'Korean', 'Chinese (Simplified)',
  'Chinese (Traditional)', 'Greek', 'Romanian', 'Czech', 'Hungarian',
];

export default function LanguageScreen() {
  const current = usePlayerStore((s) => s.prefs.targetLanguage);
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = LANGUAGES.filter((l) => l.toLowerCase().includes(q));
    return q ? list : ['Off', ...list];
  }, [query]);

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
          onSubmitEditing={() => options[0] && query && choose(options[0])}
        />
      </View>
      <FlatList
        data={options}
        keyExtractor={(l) => l}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
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
