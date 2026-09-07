import React, { useMemo, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { OptionsPickerSheet, SelectField } from "@/components/forms";
import { useTheme } from "@/theme";
import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX_LENGTH, type FeedbackCategoryId } from "./reviewPromptConfig";
import { REVIEW_PROMPT_COPY } from "./reviewPromptCopy";

type Props = {
  visible: boolean;
  accountEmail?: string | null;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    message: string;
    category: FeedbackCategoryId | "";
    allowContact: boolean;
  }) => Promise<void> | void;
};

export function FeedbackSheet({ visible, accountEmail, submitting, onClose, onSubmit }: Props) {
  const theme = useTheme();
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<FeedbackCategoryId | "">("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [allowContact, setAllowContact] = useState(false);
  const [thanks, setThanks] = useState(false);

  const categoryLabel = useMemo(
    () => FEEDBACK_CATEGORIES.find((item) => item.id === category)?.label ?? null,
    [category]
  );
  const canContact = Boolean(accountEmail?.trim());

  const reset = () => {
    setMessage("");
    setCategory("");
    setAllowContact(false);
    setThanks(false);
    setCategoryOpen(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      Alert.alert("Feedback required", "Please tell us what we can improve.");
      return;
    }
    try {
      await onSubmit({
        message: trimmed.slice(0, FEEDBACK_MESSAGE_MAX_LENGTH),
        category,
        allowContact: canContact && allowContact,
      });
      setThanks(true);
    } catch {
      Alert.alert("Couldn’t send feedback", "Please try again in a moment.");
    }
  };

  return (
    <>
      <BottomSheet
        visible={visible}
        title={thanks ? REVIEW_PROMPT_COPY.thanksTitle : REVIEW_PROMPT_COPY.feedbackTitle}
        onClose={close}
        trackPresentation={false}
        keyboardAware
      >
        {thanks ? (
          <>
            <Text
              style={{
                color: theme.colors.textSecondary,
                ...theme.typography.body,
                marginBottom: theme.spacing.lg,
              }}
            >
              {REVIEW_PROMPT_COPY.thanksBody}
            </Text>
            <Button label={REVIEW_PROMPT_COPY.doneLabel} onPress={close} />
          </>
        ) : (
          <>
            <Text
              style={{
                color: theme.colors.textSecondary,
                ...theme.typography.body,
                marginBottom: theme.spacing.md,
              }}
            >
              {REVIEW_PROMPT_COPY.feedbackBody}
            </Text>
            <TextField
              label="Feedback"
              value={message}
              onChangeText={setMessage}
              placeholder={REVIEW_PROMPT_COPY.feedbackPlaceholder}
              multiline
              maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
              style={{ minHeight: 120, textAlignVertical: "top", paddingVertical: 12 }}
            />
            <SelectField
              label={REVIEW_PROMPT_COPY.feedbackCategoryLabel}
              value={categoryLabel}
              placeholder="Optional"
              onPress={() => setCategoryOpen(true)}
            />
            {canContact ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: theme.touchTarget,
                  marginBottom: theme.spacing.md,
                  gap: theme.spacing.md,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, ...theme.typography.body }}>
                    {REVIEW_PROMPT_COPY.contactLabel}
                  </Text>
                  <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}>
                    {REVIEW_PROMPT_COPY.contactHint(accountEmail!.trim())}
                  </Text>
                </View>
                <Switch
                  value={allowContact}
                  onValueChange={setAllowContact}
                  accessibilityLabel={REVIEW_PROMPT_COPY.contactLabel}
                />
              </View>
            ) : null}
            <Button
              label={REVIEW_PROMPT_COPY.submitLabel}
              onPress={() => void submit()}
              loading={submitting}
              disabled={!message.trim()}
            />
          </>
        )}
      </BottomSheet>
      <OptionsPickerSheet
        visible={categoryOpen}
        title={REVIEW_PROMPT_COPY.feedbackCategoryLabel}
        selectedId={category || null}
        options={FEEDBACK_CATEGORIES.map((item) => ({ id: item.id, title: item.label }))}
        onClose={() => setCategoryOpen(false)}
        onSelect={(id) => {
          setCategory(id as FeedbackCategoryId);
          setCategoryOpen(false);
        }}
      />
    </>
  );
}
