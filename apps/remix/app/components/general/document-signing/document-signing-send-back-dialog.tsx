import { useEffect, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@documenso/ui/primitives/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@documenso/ui/primitives/form/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@documenso/ui/primitives/select';
import { Textarea } from '@documenso/ui/primitives/textarea';
import { useToast } from '@documenso/ui/primitives/use-toast';

const SEND_BACK_TO_SENDER_VALUE = 'sender';

const ZSendBackFormSchema = z.object({
  target: z.string().min(1, msg`Please select who to send the document back to`),
  reason: z
    .string()
    .min(1, msg`Please provide a reason`)
    .max(500, msg`Reason must be less than 500 characters`),
});

type TSendBackFormSchema = z.infer<typeof ZSendBackFormSchema>;

export interface DocumentSigningSendBackDialogProps {
  documentId: number;
  token: string;
  senderName: string;
  earlierRecipients: { id: number; name: string; email: string }[];
  onSentBack?: () => void | Promise<void>;
  trigger?: React.ReactNode;
}

export function DocumentSigningSendBackDialog({
  documentId,
  token,
  senderName,
  earlierRecipients,
  onSentBack,
  trigger,
}: DocumentSigningSendBackDialogProps) {
  const { t } = useLingui();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);

  const { mutateAsync: sendDocumentBackForCorrectionWithToken } =
    trpc.recipient.sendDocumentBackForCorrectionWithToken.useMutation();

  const form = useForm<TSendBackFormSchema>({
    resolver: zodResolver(ZSendBackFormSchema),
    defaultValues: {
      target: '',
      reason: '',
    },
  });

  const onSendBack = async ({ target, reason }: TSendBackFormSchema) => {
    try {
      await sendDocumentBackForCorrectionWithToken({
        documentId,
        token,
        targetRecipientId: target === SEND_BACK_TO_SENDER_VALUE ? null : Number(target),
        reason,
      });

      toast({
        title: t`Document sent back`,
        description: t`The document has been sent back for correction.`,
        duration: 5000,
      });

      setIsOpen(false);

      await onSentBack?.();
    } catch (err) {
      toast({
        title: t`Error`,
        description: t`An error occurred while sending the document back. Please try again.`,
        variant: 'destructive',
        duration: 5000,
      });
    }
  };

  useEffect(() => {
    if (!isOpen) {
      form.reset();
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <Trans>Send Back for Correction</Trans>
          </Button>
        )}
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Send Back for Correction</Trans>
          </DialogTitle>

          <DialogDescription>
            <Trans>
              Send this document back to an earlier recipient (or the sender) to fix a mistake.
              Their previously collected fields will be cleared so they can redo them; everyone
              else's information is left as-is.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSendBack)} className="space-y-4">
            <FormField
              control={form.control}
              name="target"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans>Send back to</Trans>
                  </FormLabel>
                  <FormControl>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t`Choose a recipient`} />
                      </SelectTrigger>
                      <SelectContent>
                        {earlierRecipients.map((recipient) => (
                          <SelectItem key={recipient.id} value={String(recipient.id)}>
                            {recipient.name || recipient.email}
                          </SelectItem>
                        ))}
                        <SelectItem value={SEND_BACK_TO_SENDER_VALUE}>
                          {t`The sender (${senderName})`}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <Trans>Reason</Trans>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      placeholder={t`Explain what needs to be corrected`}
                      disabled={form.formState.isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsOpen(false)}
                disabled={form.formState.isSubmitting}
              >
                <Trans>Cancel</Trans>
              </Button>

              <Button
                type="submit"
                loading={form.formState.isSubmitting}
                disabled={!form.formState.isValid}
              >
                <Trans>Send Back</Trans>
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
