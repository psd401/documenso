import { prisma } from '@documenso/prisma';
import { hash } from '@node-rs/bcrypt';
import type { User } from '@prisma/client';

import { SALT_ROUNDS } from '../../constants/auth';
import { AppError, AppErrorCode } from '../../errors/app-error';
import { ensurePsd401BaselineMembership } from '../directory-sync/psd401-membership';

export interface CreateUserOptions {
  name: string;
  email: string;
  password: string;
  signature?: string | null;
}

export const createUser = async ({ name, email, password, signature }: CreateUserOptions) => {
  const hashedPassword = await hash(password, SALT_ROUNDS);

  const userExists = await prisma.user.findFirst({
    where: {
      email: email.toLowerCase(),
    },
  });

  if (userExists) {
    throw new AppError(AppErrorCode.ALREADY_EXISTS);
  }

  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      password: hashedPassword, // Todo: (RR7) Drop password.
      signature,
    },
  });

  await onCreateUserHook(user).catch((err) => {
    console.error(err);
  });

  return user;
};

export type OnCreateUserHookOptions = {
  /**
   * Upstream: when true, do not create a "Personal Organisation" for the new user.
   *
   * PSD401 never creates personal organisations; every new user joins the PSD401
   * org instead, so this option has no effect here. It is kept so upstream call
   * sites (e.g. the organisation SSO callback) keep compiling.
   */
  skipPersonalOrganisation?: boolean;
};

/**
 * Should be run after a user is created, example during email password signup or google sign in.
 *
 * PSD401: adds every new user to the PSD401 org with both the org member group and the
 * Default team group, regardless of `options`.
 *
 * @returns User
 */
export const onCreateUserHook = async (user: User, _options: OnCreateUserHookOptions = {}) => {
  await ensurePsd401BaselineMembership(user.id);

  return user;
};
