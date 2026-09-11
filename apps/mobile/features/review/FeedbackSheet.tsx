import React, { useMemo, useState } from "react";
import { Alert, Text } from "react-native";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { OptionsPickerSheet, SelectField } from "@/components/forms";
import { useTheme } from "@/theme";
import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX_LENGTH, type FeedbackCategoryId } from "./reviewPromptConfig";
import { REVIEW_PROMPT_COPY } from "./reviewPromptCopy";

type Props = {
  visible: boolean;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    message: string;
    category: FeedbackCategoryId | "";
  }) => Promise<void> | void;
};

export function FeedbackSheet({ visible, submitting, onClose, onSubmit }: Props) {
  const theme = useTheme();
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<FeedbackCategoryId | "">("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [thanks, setThanks] = useState(false);

  const categoryLabel = useMemo(
    () => FEEDBACK_CATEGORIES.find((item) => item.id === category)?.label ?? null,
    [category]
  );

  const reset = () => {
    setMessage("");
    setCategory("");
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
