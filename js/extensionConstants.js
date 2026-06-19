const KNOWN_OE_VERSIONS = ['11.7', '12.8'];

const FILE_TYPES = {
    XREF:     'XREF',
    PROPARSE: 'PROPARSE'
};

/**
 * Default DLC subdirectories that should always be included in the PROPATH
 * for Proparse to correctly resolve built-in ABL types and includes.
 * Each entry is relative to the DLC root.
 */
const DEFAULT_DLC_PROPATH_ENTRIES = [
    'tty/netlib/OpenEdge.net.pl',
    '',                               // DLC root itself
    'bin',
    'gui',
    'gui/ablunit.apl',
    'gui/adecomm.apl',
    'gui/adedict.apl',
    'gui/adeicon.apl',
    'gui/dataadmin.apl',
    'gui/OpenEdge.BusinessLogic.apl',
    'gui/OpenEdge.Core.apl',
    'gui/OpenEdge.ServerAdmin.apl',
    'gui/prodict.apl',
    'gui/adecomp.pl',
    'gui/adedesk.pl',
    'gui/adeedit.pl',
    'gui/aderes.pl',
    'gui/adeshar.pl',
    'gui/adeuib.pl',
    'gui/adeweb.pl',
    'gui/adexml.pl',
    'gui/protools.pl'
];

module.exports = {
    KNOWN_OE_VERSIONS,
    FILE_TYPES,
    DEFAULT_DLC_PROPATH_ENTRIES
};