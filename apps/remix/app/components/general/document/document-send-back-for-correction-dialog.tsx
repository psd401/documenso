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
  FormMessage,
} from '@documenso/ui/primitives/form/form';
import { Textarea } from '@documenso/ui/primitives/textarea';
import { useToast } from '@documenso/ui/primitives/use-toast';

const ZSendBackFormSchema = z.object({
  reason: z
    .string()
    .min(1, msg`Please provide a reason`)
    .max(500, msg`Reason must be less than 500 characters`),
});

type TSendBackFormSchema = z.infer<typeof ZSendBackFormSchema>;

export interface DocumentSendBackForCorrectionDialogProps {
  envelopeId: string;
  recipientId: number;
  recipientName: string;
  trigger?: React.ReactNode;
}

export function DocumentSendBackForCorrectionDialog({
  envelopeId,
  recipientId,
  recipientName,
  trigger,
}: DocumentSendBackForCorrectionDialogProps) {
  const { t } = useLingui();
  const { toast } = useToast();

  const [isOpen, setIsOpen] = useState(false);

  const { mutateAsync: sendBackForCorrection } = trpc.envelope.sendBackForCorrection.useMutation();

  const form = useForm<TSendBackFormSchema>({
    resolver: zodResolver(ZSendBackFormSchema),
    defaultValues: {
      reason: '',
    },
  });

  const onSendBack = async ({ reason }: TSendBackFormSchema) => {
    try {
      await sendBackForCorrection({
        envelopeId,
        targetRecipientId: recipientId,
        reason,
      });

      toast({
        title: t`Document sent back`,
        description: t`${recipientName} has been asked to correct their part of the document.`,
        duration: 5000,
      });

      setIsOpen(false);
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
          <Button variant="outline" size="sm">
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
              Send this document back to {recipientName} so they can correct their submission.
              Their previously collected fields will be cleared so they can redo them; everyone
              else's information is left as-is.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSendBack)} className="space-y-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
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
